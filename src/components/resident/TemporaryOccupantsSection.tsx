import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const RELATIONS = { guest: "Guest", relative: "Relative", caretaker: "Caretaker", other: "Other" } as const;
const ERRORS: Record<string, string> = {
  too_many_occupants: "You can have up to 10 current temporary occupants.",
  invalid_dates: "Choose a start date from today onwards and an end within 180 days.",
  rate_limited: "Too many additions today. Please try tomorrow.",
  not_authorized: "Only current residents of this home can do this.",
};
const friendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k] : "That didn't work. Please try again.";
};
const today = () => new Date().toISOString().slice(0, 10);

/** Short-stay people (guests, relatives, caretakers) living in the home for a set period. */
export function TemporaryOccupantsSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", relation: "guest", phone: "", from: today(), until: today() });

  const q = useQuery({
    queryKey: ["temporary-occupants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("temporary_occupants")
        .select("id,full_name,relation,stay_from,stay_until,ended_at")
        .is("ended_at", null).gte("stay_until", today()).order("stay_from");
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { error } = await supabase.rpc("add_temporary_occupant", {
        _name: f.name, _relation: f.relation, _phone: f.phone, _from: f.from, _until: f.until,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Added"); setOpen(false); setF({ ...f, name: "", phone: "" }); qc.invalidateQueries({ queryKey: ["temporary-occupants"] }); },
    onError: (e) => toast.error(friendly(e)),
  });
  const end = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("end_temporary_occupant", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Stay ended"); qc.invalidateQueries({ queryKey: ["temporary-occupants"] }); },
    onError: (e) => toast.error(friendly(e)),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold"><CalendarClock className="h-4 w-4" />Staying temporarily</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="outline" className="min-h-11 rounded-xl"><UserPlus className="mr-1.5 h-4 w-4" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add a temporary occupant</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <div><Label htmlFor="to-name">Full name</Label><Input id="to-name" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label htmlFor="to-rel">Relation</Label>
                <select id="to-rel" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
                  {Object.entries(RELATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><Label htmlFor="to-phone">Phone (optional)</Label><Input id="to-phone" inputMode="tel" pattern="[0-9+ ]{8,16}" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="to-from">From</Label><Input id="to-from" type="date" required min={today()} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
                <div><Label htmlFor="to-until">Until</Label><Input id="to-until" type="date" required min={f.from} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></div>
              </div>
              <Button type="submit" className="min-h-11 w-full rounded-xl" disabled={add.isPending}>{add.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">Couldn't load temporary occupants.</p>}
      {q.data?.length === 0 && <p className="text-sm text-muted-foreground">No one is staying temporarily.</p>}
      <ul className="space-y-2">
        {q.data?.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{o.full_name}</p>
              <p className="text-xs text-muted-foreground">{RELATIONS[o.relation as keyof typeof RELATIONS] ?? o.relation} · {o.stay_from} to {o.stay_until}</p>
            </div>
            <Button variant="ghost" className="min-h-11" disabled={end.isPending} onClick={() => end.mutate(o.id)}>End stay</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
