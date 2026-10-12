import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Plus, TicketPercent } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { adminListDiscountCodes, adminSaveDiscountCode, type DiscountCode } from "@/lib/saas-upi-payment.functions";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_admin/admin/discount-codes")({
  head: () => ({
    meta: [
      { title: "Discount codes — SociyoHub Super Admin" },
      { name: "description", content: "Create and manage discount codes for SociyoHub plans." },
      { property: "og:title", content: "Discount codes — SociyoHub Super Admin" },
      { property: "og:description", content: "Create and manage discount codes for SociyoHub plans." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiscountCodesPage,
});

const PLANS = [["basic", "Starter"], ["pro", "Growth"], ["premium", "Pro"]] as const;
type Form = { id: string | null; code: string; pct: string; plans: string[]; from: string; until: string; max: string; active: boolean; note: string; used: boolean };
const empty: Form = { id: null, code: "", pct: "", plans: [], from: "", until: "", max: "", active: true, note: "", used: false };
const toLocal = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");

function DiscountCodesPage() {
  const qc = useQueryClient();
  const list = useServerFn(adminListDiscountCodes);
  const save = useServerFn(adminSaveDiscountCode);
  const codes = useQuery({ queryKey: ["admin-discount-codes"], queryFn: () => list() });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(c: DiscountCode) {
    setForm({ id: c.id, code: c.code, pct: String(c.percent_off), plans: c.plan_ids ?? [], from: toLocal(c.valid_from), until: toLocal(c.valid_until),
      max: c.max_uses ? String(c.max_uses) : "", active: c.is_active, note: c.note ?? "", used: c.uses > 0 });
  }

  async function submit() {
    if (!form || busy) return;
    const pct = Number(form.pct);
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(form.code) || !(pct > 0 && pct <= 50)) return toast.error(tu("ln.dc.check"));
    const max = form.max ? Number(form.max) : null;
    if (max !== null && !(Number.isInteger(max) && max >= 1)) return toast.error(tu("ln.dc.check"));
    setBusy(true);
    try {
      await save({ data: { id: form.id, code: form.code.toUpperCase(), percentOff: pct, planIds: form.plans.length ? (form.plans as ("basic" | "pro" | "premium")[]) : null,
        validFrom: toIso(form.from), validUntil: toIso(form.until), maxUses: max, isActive: form.active, note: form.note.trim() || null } });
      toast.success(tu("ln.dc.saved"));
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["admin-discount-codes"] });
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === "code_exists" ? tu("ln.dc.exists") : m === "code_in_use" ? tu("ln.dc.inUse") : tu("ln.upi.fail"));
    } finally { setBusy(false); }
  }

  return (
    <PageShell>
      <PageHeader title={tu("ln.dc.title")} description={tu("ln.dc.help")}
        actions={<Button className="h-11 rounded-xl" onClick={() => setForm(empty)}><Plus className="mr-1 h-4 w-4" />{tu("ln.dc.new")}</Button>} />
      {codes.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : codes.isError ? <ErrorState onRetry={() => void codes.refetch()} /> : (codes.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <TicketPercent className="mx-auto mb-2 h-8 w-8" />{tu("ln.dc.none")}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {codes.data!.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold">{c.code}</p>
                  <p className="text-sm text-muted-foreground">{c.percent_off}% · {c.plan_ids?.length ? c.plan_ids.map((p) => PLANS.find((x) => x[0] === p)?.[1]).join(", ") : tu("ln.dc.all")}</p>
                  <p className="text-xs text-muted-foreground">{day(c.valid_from)} → {day(c.valid_until)} · {tu("ln.dc.uses").replace("{{n}}", String(c.uses))}{c.max_uses ? ` / ${c.max_uses}` : ""}</p>
                  {c.note && <p className="mt-1 text-xs">{c.note}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? tu("ln.dc.active") : tu("ln.dc.off")}</Badge>
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => edit(c)}>{tu("ln.dc.edit")}</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!form} onOpenChange={(v) => (!v && !busy ? setForm(null) : null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? tu("ln.dc.edit") : tu("ln.dc.new")}</DialogTitle>
            <DialogDescription>{form?.used ? tu("ln.dc.inUse") : tu("ln.dc.help")}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="dc-code">{tu("ln.dc.code")}</Label>
                  <Input id="dc-code" className="h-11 font-mono uppercase" maxLength={24} disabled={form.used} value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} /></div>
                <div className="space-y-1"><Label htmlFor="dc-pct">{tu("ln.dc.pct")}</Label>
                  <Input id="dc-pct" className="h-11" type="number" min={1} max={50} step="0.5" disabled={form.used} value={form.pct}
                    onChange={(e) => setForm({ ...form, pct: e.target.value })} /></div>
              </div>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">{tu("ln.dc.plans")}</legend>
                <div className="flex flex-wrap gap-2">
                  {PLANS.map(([id, name]) => {
                    const on = form.plans.includes(id);
                    return <button key={id} type="button" aria-pressed={on} onClick={() => setForm({ ...form, plans: on ? form.plans.filter((x) => x !== id) : [...form.plans, id] })}
                      className={`min-h-11 rounded-full border px-4 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{name}</button>;
                  })}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="dc-from">{tu("ln.dc.from")}</Label><Input id="dc-from" type="datetime-local" className="h-11" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="dc-until">{tu("ln.dc.until")}</Label><Input id="dc-until" type="datetime-local" className="h-11" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="dc-max">{tu("ln.dc.max")}</Label><Input id="dc-max" type="number" min={1} className="h-11" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="dc-note">{tu("ln.dc.note")}</Label><Input id="dc-note" maxLength={200} className="h-11" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <label className="flex items-center justify-between gap-3 text-sm font-medium">{tu("ln.dc.active")}<Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></label>
            </div>
          )}
          <DialogFooter>
            <Button className="h-11 rounded-xl" disabled={busy} onClick={() => void submit()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("ln.dc.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
