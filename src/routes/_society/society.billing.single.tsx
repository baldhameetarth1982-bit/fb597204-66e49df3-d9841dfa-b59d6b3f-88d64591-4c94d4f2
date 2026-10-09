import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FilePlus2, IndianRupee, CalendarDays, Plus, Trash2, Building2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState, PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";
import { generateFlatBill } from "@/lib/maintenance.functions";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";

export const Route = createFileRoute("/_society/society/billing/single")({
  head: () => ({
    meta: [
      { title: "Bill One Home — SociyoHub" },
      { name: "description", content: "Create a single maintenance bill for one house in your society." },
      { property: "og:title", content: "Bill One Home — SociyoHub" },
      { property: "og:description", content: "Create a single maintenance bill for one house in your society." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SingleBillPage,
});

type Flat = { id: string; label: string };
type Period = { id: string; period_label: string; amount_due: number };
type Charge = { key: number; description: string; amount: string };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function SingleBillPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const navigate = useNavigate();
  const createBill = useServerFn(generateFlatBill);

  const [flats, setFlats] = useState<Flat[]>([]);
  const [loading, setLoading] = useState(true);
  const [flatId, setFlatId] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [charges, setCharges] = useState<Charge[]>([]);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [f, b] = await Promise.all([
        supabase.from("flats").select("id, flat_number, block_id").eq("society_id", societyId).order("flat_number").limit(5000),
        supabase.from("blocks").select("id, name").eq("society_id", societyId),
      ]);
      const blocks: Record<string, string> = Object.fromEntries(((b.data as any[]) ?? []).map((x) => [x.id, x.name]));
      setFlats(((f.data as any[]) ?? [])
        .map((x) => ({ id: x.id, label: `${x.block_id && blocks[x.block_id] ? `${blocks[x.block_id]}-` : ""}${x.flat_number}` }))
        .sort((a, z) => a.label.localeCompare(z.label, "en", { numeric: true })));
      setLoading(false);
    })();
  }, [societyId, sidLoading]);

  useEffect(() => {
    setPicked(new Set()); setPeriods([]);
    if (!flatId) return;
    let live = true;
    setPeriodsLoading(true);
    supabase.from("maintenance_periods").select("id, period_label, amount_due")
      .eq("flat_id", flatId).is("bill_id", null).neq("status", "paid").order("period_start")
      .then(({ data }) => {
        if (!live) return;
        setPeriods(((data as any[]) ?? []).map((p) => ({ ...p, amount_due: Number(p.amount_due) })));
        setPeriodsLoading(false);
      });
    return () => { live = false; };
  }, [flatId]);

  const validCharges = charges.filter((c) => c.description.trim() && Number(c.amount) > 0);
  const total = useMemo(
    () => periods.filter((p) => picked.has(p.id)).reduce((s, p) => s + p.amount_due, 0)
      + validCharges.reduce((s, c) => s + Number(c.amount), 0),
    [periods, picked, validCharges],
  );
  const canCreate = !!flatId && (picked.size > 0 || validCharges.length > 0) && !saving;

  function togglePeriod(id: string) {
    setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function submit() {
    if (!canCreate) return toast.error(tu("ln.sb.needItem"));
    setSaving(true);
    try {
      const { billId } = await createBill({ data: {
        flatId,
        periodIds: [...picked],
        additional: validCharges.map((c) => ({ description: c.description.trim(), amount: Number(c.amount) })),
        dueDate: dueDate || null,
        notes: notes.trim() || null,
      } });
      toast.success(tu("ln.sb.done"));
      if (billId) navigate({ to: "/society/bills/$id", params: { id: String(billId) } });
    } catch (e) {
      toast.error(toSafeFinanceMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title={tu("ln.sb.title")} description={tu("ln.sb.desc")} />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>

      {sidLoading || loading ? (
        <div className="min-h-[30vh] grid place-items-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : flats.length === 0 ? (
        <EmptyState icon={Building2} title={tu("op.no_houses_yet")} description={tu("op.set_up_blocks_and_houses")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-5">
            <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sb-house">{tu("ln.sb.house")}</Label>
                <Select value={flatId} onValueChange={setFlatId}>
                  <SelectTrigger id="sb-house" className="h-11 rounded-xl"><SelectValue placeholder={tu("ln.sb.pickHouse")} /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {flats.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sb-due">{tu("rbd.dueDate")}</Label>
                <div className="relative">
                  <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input id="sb-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
            </section>

            {flatId && (
              <section aria-labelledby="sb-per" className="rounded-2xl border border-border bg-card">
                <h2 id="sb-per" className="border-b border-border px-5 py-3 text-sm font-semibold">{tu("ln.sb.periods")}</h2>
                {periodsLoading ? (
                  <div className="grid place-items-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : periods.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">{tu("ln.sb.noPeriods")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {periods.map((p) => (
                      <li key={p.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-5 py-2 text-sm">
                          <input type="checkbox" className="h-5 w-5" checked={picked.has(p.id)} onChange={() => togglePeriod(p.id)} />
                          <span className="flex-1">{p.period_label}</span>
                          <span className="tabular-nums">{inr(p.amount_due)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {flatId && (
              <section aria-labelledby="sb-ex" className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="sb-ex" className="text-sm font-semibold">{tu("ln.sb.extra")}</h2>
                  <Button type="button" variant="outline" className="min-h-11 rounded-xl"
                    onClick={() => setCharges((c) => [...c, { key: Date.now(), description: "", amount: "" }])}>
                    <Plus className="h-4 w-4 mr-1" aria-hidden />{tu("ln.sb.addCharge")}
                  </Button>
                </div>
                {charges.map((c, i) => (
                  <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2">
                    <Input aria-label={tu("ln.sb.chargeName")} placeholder={tu("ln.sb.chargeName")} maxLength={200} value={c.description}
                      onChange={(e) => setCharges((all) => all.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} className="h-11 rounded-xl" />
                    <div className="relative">
                      <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                      <Input aria-label={tu("op.amount")} type="number" inputMode="decimal" min={0} value={c.amount}
                        onChange={(e) => setCharges((all) => all.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="h-11 pl-8 rounded-xl" />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={tu("ln.sb.remove")}
                      onClick={() => setCharges((all) => all.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="sb-notes">{tu("ln.sb.notes")}</Label>
                  <Input id="sb-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11 rounded-xl" />
                </div>
              </section>
            )}
          </div>

          <aside className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-20" aria-label={tu("ln.sb.total")}>
            <p className="text-sm text-muted-foreground">{tu("ln.sb.total")}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{inr(total)}</p>
            <p className="mt-4 flex gap-2 rounded-xl bg-warning-container px-3 py-2 text-xs text-warning-container-foreground">
              <Info className="h-4 w-4 shrink-0" aria-hidden />{tu("ln.sb.final")}
            </p>
            <Button className="mt-4 h-11 w-full rounded-xl" disabled={!canCreate} onClick={() => void submit()}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePlus2 className="h-4 w-4 mr-2" aria-hidden />}{tu("ln.sb.create")}
            </Button>
            {flatId && !canCreate && !saving && <p className="mt-2 text-xs text-muted-foreground">{tu("ln.sb.needItem")}</p>}
            <Button asChild variant="ghost" className="mt-2 h-11 w-full rounded-xl"><Link to="/society/billing">{tu("op.bill_history")}</Link></Button>
          </aside>
        </div>
      )}
    </PageShell>
  );
}
