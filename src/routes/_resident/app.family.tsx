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
import { PetsSection } from "@/components/resident/PetsSection";
import { useTranslation } from "react-i18next";
import { TemporaryOccupantsSection } from "@/components/resident/TemporaryOccupantsSection";

export const Route = createFileRoute("/_resident/app/family")({
  head: () => ({ meta: [{ title: "Family — SociyoHub" }] }),
  component: FamilyPage,
});

const RELATION_KEYS: Record<string, string> = {
  spouse: "fam.r.spouse", child: "fam.r.child", parent: "fam.r.parent",
  sibling: "fam.r.sibling", helper: "fam.r.helper", other: "cm.other",
};

// Only pass through short, plain messages we authored (e.g. the 15-member cap);
// anything technical becomes a generic retry message.
function safeMessage(e: unknown, fallback: string, t: (k: string) => string) {
  const m = e instanceof Error ? e.message : "";
  if (/Maximum 15 family members/i.test(m)) return t("fam.e.max");
  if (m && m.length <= 120 && !/sql|relation|column|constraint|violat|rpc|uuid|stack|\bat\b.*:\d+|zod|\{/i.test(m)) return m;
  return fallback;
}

function FamilyPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const list = useServerFn(listFamily);
  const add = useServerFn(addFamily);
  const del = useServerFn(deleteFamily);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["family"], queryFn: () => list() });

  const groups = [
    { key: "family", label: t("prof.family"), items: (data ?? []).filter((m: any) => m.relation !== "helper") },
    { key: "helpers", label: t("fam.g.helpers"), items: (data ?? []).filter((m: any) => m.relation === "helper") },
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
      toast.success(t("fam.t.added"));
      qc.invalidateQueries({ queryKey: ["family"] });
      setName(""); setPhone(""); setAge(""); setRelation("spouse");
      setOpen(false);
    },
    onError: (e) => toast.error(safeMessage(e, t("fam.e.add"), t)),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family"] }); toast.success(t("vh.removed")); setRemoveTarget(null); },
    onError: (e) => toast.error(safeMessage(e, t("fam.e.remove"), t)),
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
        title={t("fam.title")}
        description={t("fam.desc")}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl h-11"><UserPlus className="h-4 w-4 mr-2" /> {t("fam.addMember")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("fam.addTitle")}</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid gap-2"><Label htmlFor="fm-name">{t("st.fullName")}</Label><Input id="fm-name" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} className="h-11" /></div>
                <div className="grid gap-2"><Label>{t("fam.relation")}</Label>
                  <Select value={relation} onValueChange={setRelation}>
                    <SelectTrigger aria-label={t("fam.relation")} className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(RELATION_KEYS).map(([v, k]) => <SelectItem key={v} value={v}>{t(k)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label htmlFor="fm-phone">{t("fam.phoneOpt")}</Label><Input id="fm-phone" type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." className="h-11" /></div>
                  <div className="grid gap-2"><Label htmlFor="fm-age">{t("fam.ageOpt")}</Label><Input id="fm-age" type="number" inputMode="numeric" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} className="h-11" /></div>
                </div>
                <Button type="submit" className="w-full h-11 rounded-xl" disabled={addMut.isPending}>{addMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("common.save")}</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-4" aria-busy="true" role="status" aria-label={t("fam.loading")}>
          <Skeleton className="mb-4 h-6 w-40" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-14 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState title={t("fam.loadFailed")} description={t("fam.checkConn")} onRetry={() => void refetch()} />
      ) : (
        <section aria-labelledby="household-h" className="overflow-hidden rounded-2xl border border-border bg-card">
          <header className="flex items-center gap-3 border-b border-border px-4 py-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-container text-primary-container-foreground"><Home className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <h2 id="household-h" className="font-semibold">{t("fam.household")}</h2>
              <p className="text-sm text-muted-foreground"><span className="tabular-nums">{t("fam.count", { count: data?.length ?? 0 })}</span></p>
            </div>
          </header>
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><User className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><p className="font-medium">{t("fam.you")}</p><p className="text-sm text-muted-foreground">{t("fam.holder")}</p></div>
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
                          {RELATION_KEYS[m.relation] ? t(RELATION_KEYS[m.relation]) : m.relation}{m.age != null ? ` · ${t("fam.years", { age: m.age })}` : ""}{m.phone ? ` · ${m.phone}` : ""}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("fam.removeName", { name: m.full_name })} onClick={() => setRemoveTarget({ id: m.id, full_name: m.full_name })}>
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
              <p className="font-medium">{t("fam.none")}</p>
              <p className="text-sm text-muted-foreground">{t("fam.noneHint")}</p>
            </div>
          )}
          {(data?.length ?? 0) < 15 && (
            <div className="border-t border-border p-3">
              <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setOpen(true)}><UserPlus className="mr-2 h-4 w-4" />{t("fam.addMember")}</Button>
            </div>
          )}
        </section>
      )}

      <PetsSection />
      <TemporaryOccupantsSection />

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o && !delMut.isPending) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fam.removeQ", { name: removeTarget?.full_name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("fam.removeWarn")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMut.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={delMut.isPending}
              onClick={(e) => { e.preventDefault(); if (removeTarget) delMut.mutate(removeTarget.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {delMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{t("fd.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
