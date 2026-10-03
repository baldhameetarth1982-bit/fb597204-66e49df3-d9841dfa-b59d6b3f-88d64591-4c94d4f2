import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PawPrint, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/system/ErrorState";

const SPECIES: Record<string, string> = { dog: "Dog", cat: "Cat", bird: "Bird", fish: "Fish", other: "Other" };

function friendly(e: unknown, fallback: string) {
  const m = e instanceof Error ? e.message : (e as { message?: string })?.message ?? "";
  return /^(Maximum 10 pets|No active home|Pet not found)/.test(m) ? m : fallback;
}

export function PetsSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("dog");
  const [breed, setBreed] = useState("");
  const [vacc, setVacc] = useState("");

  const q = useQuery({
    queryKey: ["my-pets"],
    queryFn: async () => {
      const { data: flat, error: fe } = await supabase.rpc("_my_active_flat" as never);
      if (fe) throw fe;
      const flatId = (flat as unknown as { flat_id: string }[] | null)?.[0]?.flat_id;
      if (!flatId) return [];
      const { data, error } = await supabase
        .from("flat_pets")
        .select("id, name, species, breed, vaccinated_until")
        .eq("flat_id", flatId).eq("is_active", true).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("resident_add_pet", {
        _name: name.trim(), _species: species, _breed: breed.trim() || undefined, _vaccinated_until: vacc || undefined,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pet added"); setName(""); setBreed(""); setVacc(""); setOpen(false); qc.invalidateQueries({ queryKey: ["my-pets"] }); },
    onError: (e) => toast.error(friendly(e, "Couldn't add this pet. Please try again.")),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("resident_remove_pet", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["my-pets"] }); },
    onError: (e) => toast.error(friendly(e, "Couldn't remove this pet. Please try again.")),
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section aria-labelledby="pets-h" className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-container text-primary-container-foreground"><PawPrint className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="pets-h" className="font-semibold">Pets</h2>
          <p className="text-sm text-muted-foreground">Registered with your home. Visible to your household and committee.</p>
        </div>
      </header>
      {q.isLoading ? (
        <div className="p-4" role="status" aria-label="Loading pets"><Skeleton className="h-14 rounded-xl" /></div>
      ) : q.isError ? (
        <div className="p-4"><ErrorState title="Couldn't load pets" description="Please try again." onRetry={() => void q.refetch()} /></div>
      ) : (
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((p) => {
            const expired = p.vaccinated_until && p.vaccinated_until < today;
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {SPECIES[p.species] ?? p.species}{p.breed ? ` · ${p.breed}` : ""}
                    {p.vaccinated_until ? (expired ? " · Vaccination overdue" : ` · Vaccinated till ${p.vaccinated_until}`) : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Remove ${p.name}`} disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            );
          })}
          {!q.data?.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No pets registered.</li>}
        </ul>
      )}
      <div className="border-t border-border p-3">
        <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add pet</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add pet</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!add.isPending && name.trim()) add.mutate(); }}>
            <div className="grid gap-2"><Label htmlFor="pet-name">Name</Label><Input id="pet-name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-11" /></div>
            <div className="grid gap-2"><Label>Type</Label>
              <Select value={species} onValueChange={setSpecies}>
                <SelectTrigger aria-label="Pet type" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SPECIES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label htmlFor="pet-breed">Breed (optional)</Label><Input id="pet-breed" maxLength={40} value={breed} onChange={(e) => setBreed(e.target.value)} className="h-11" /></div>
              <div className="grid gap-2"><Label htmlFor="pet-vacc">Vaccinated till</Label><Input id="pet-vacc" type="date" value={vacc} onChange={(e) => setVacc(e.target.value)} className="h-11" /></div>
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={add.isPending}>{add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
