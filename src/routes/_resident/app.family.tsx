import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, UserPlus, Trash2, Users } from "lucide-react";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { listFamily, addFamily, deleteFamily } from "@/lib/family.functions";

export const Route = createFileRoute("/_resident/app/family")({
  head: () => ({ meta: [{ title: "Family — SociyoHub" }] }),
  component: FamilyPage,
});

const RELATION_LABELS: Record<string, string> = {
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  helper: "Helper / Domestic",
  other: "Other",
};

function FamilyPage() {
  const qc = useQueryClient();
  const list = useServerFn(listFamily);
  const add = useServerFn(addFamily);
  const del = useServerFn(deleteFamily);

  const { data, isLoading } = useQuery({ queryKey: ["family"], queryFn: () => list() });

  const addMut = useMutation({
    mutationFn: (input: any) => add({ data: input }),
    onSuccess: () => { toast.success("Family member added"); qc.invalidateQueries({ queryKey: ["family"] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message ?? "Could not add"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family"] }); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message ?? "Could not remove"),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("spouse");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    addMut.mutate({
      full_name: name.trim(),
      relation,
      phone: phone.trim() || null,
      age: age ? Number(age) : null,
    });
    setName(""); setPhone(""); setAge(""); setRelation("spouse");
  }

  return (
    <PageShell>
      <PageHeader
        title="Family & Household"
        description="Add family members and domestic helpers linked to your flat."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl h-11"><UserPlus className="h-4 w-4 mr-2" /> Add member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add family member</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid gap-2"><Label>Full name</Label><Input maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="grid gap-2"><Label>Relation</Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(RELATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label>Phone (optional)</Label><Input maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." /></div>
                  <div className="grid gap-2"><Label>Age (optional)</Label><Input type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} /></div>
                </div>
                <Button className="w-full h-11 rounded-xl" disabled={addMut.isPending}>{addMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="py-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data?.length ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No family members yet</p>
          <p className="text-sm text-muted-foreground">Add spouse, kids and helpers so the gate can recognise them.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {data.map((m: any) => (
            <Card key={m.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold">
                  {m.full_name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{m.full_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {RELATION_LABELS[m.relation] ?? m.relation}{m.phone ? ` · ${m.phone}` : ""}{m.age ? ` · ${m.age}y` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => delMut.mutate(m.id)} disabled={delMut.isPending}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
