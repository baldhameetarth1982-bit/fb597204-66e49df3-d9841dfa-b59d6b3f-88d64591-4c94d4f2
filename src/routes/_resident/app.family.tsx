import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, UserPlus, Trash2, Users, Home, User } from "lucide-react";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorState } from "@/components/system/ErrorState";
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

// Only pass through short, plain messages we authored (e.g. the 15-member cap);
// anything technical becomes a generic retry message.
function safeMessage(e: unknown, fallback: string) {
  const m = e instanceof Error ? e.message : "";
  if (m && m.length <= 120 && !/sql|relation|column|constraint|violat|rpc|uuid|stack|\bat\b.*:\d+|zod|\{/i.test(m)) return m;
  return fallback;
}

function FamilyPage() {
  const qc = useQueryClient();
  const list = useServerFn(listFamily);
  const add = useServerFn(addFamily);
  const del = useServerFn(deleteFamily);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["family"], queryFn: () => list() });

  const groups = [
    { key: "family", label: "Family", items: (data ?? []).filter((m: any) => m.relation !== "helper") },
    { key: "helpers", label: "Domestic help", items: (data ?? []).filter((m: any) => m.relation === "helper") },
  ];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("spouse");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; full_name: string } | null>(null);

  const addMut = useMutation({
    mutationFn: (input: any) => add({ data: input }),
    onSuccess: () => {
      toast.success("Family member added");
      qc.invalidateQueries({ queryKey: ["family"] });
      setName(""); setPhone(""); setAge(""); setRelation("spouse");
      setOpen(false);
    },
    onError: (e) => toast.error(safeMessage(e, "Couldn't add this member. Your entries are kept — please try again.")),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family"] }); toast.success("Removed"); setRemoveTarget(null); },
    onError: (e) => toast.error(safeMessage(e, "Couldn't remove this member. Please try again.")),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (addMut.isPending) return;
    addMut.mutate({
      full_name: name.trim(),
      relation,
      phone: phone.trim() || null,
      age: age ? Number(age) : null,
    });
  }

  return (
    <PageShell>
      <PageHeader
        title="Family & Household"
        description="Add family members and domestic helpers linked to your home. Only you and your committee can see them."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl h-11"><UserPlus className="h-4 w-4 mr-2" /> Add member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add family member</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid gap-2"><Label htmlFor="fm-name">Full name</Label><Input id="fm-name" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} className="h-11" /></div>
                <div className="grid gap-2"><Label>Relation</Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(RELATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label htmlFor="fm-phone">Phone (optional)</Label><Input id="fm-phone" type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." className="h-11" /></div>
                  <div className="grid gap-2"><Label htmlFor="fm-age">Age (optional)</Label><Input id="fm-age" type="number" inputMode="numeric" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} className="h-11" /></div>
                </div>
                <Button type="submit" className="w-full h-11 rounded-xl" disabled={addMut.isPending}>{addMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-4" aria-busy="true" role="status" aria-label="Loading household">
          <Skeleton className="mb-4 h-6 w-40" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-14 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState title="Couldn't load your household" description="Please check your connection and try again." onRetry={() => void refetch()} />
      ) : (
        <section aria-labelledby="household-h" className="overflow-hidden rounded-2xl border border-border bg-card">
          <header className="flex items-center gap-3 border-b border-border px-4 py-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-container text-primary-container-foreground"><Home className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <h2 id="household-h" className="font-semibold">Your household</h2>
              <p className="text-sm text-muted-foreground"><span className="tabular-nums">{(data?.length ?? 0)} of 15</span> members added</p>
            </div>
          </header>
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><User className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><p className="font-medium">You</p><p className="text-sm text-muted-foreground">Account holder</p></div>
            </li>
            {groups.map((g) => g.items.length > 0 && (
              <li key={g.key}>
                <p className="bg-muted/50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <ul className="divide-y divide-border">
                  {g.items.map((m: any) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
                        {m.full_name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{m.full_name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {RELATION_LABELS[m.relation] ?? m.relation}{m.age != null ? ` · ${m.age} yrs` : ""}{m.phone ? ` · ${m.phone}` : ""}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Remove ${m.full_name}`} onClick={() => setRemoveTarget({ id: m.id, full_name: m.full_name })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {!data?.length && (
            <div className="border-t border-border px-4 py-8 text-center">
              <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No family members yet</p>
              <p className="text-sm text-muted-foreground">Add spouse, kids and helpers so the gate can recognise them.</p>
            </div>
          )}
          {(data?.length ?? 0) < 15 && (
            <div className="border-t border-border p-3">
              <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Add member</Button>
            </div>
          )}
        </section>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o && !delMut.isPending) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>They'll no longer be listed with your home. You can add them again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={delMut.isPending}
              onClick={(e) => { e.preventDefault(); if (removeTarget) delMut.mutate(removeTarget.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {delMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
