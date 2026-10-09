import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FilePlus2, IndianRupee, CalendarDays, Plus, Trash2, Building2, Info, ChevronLeft, ChevronRight } from "lucide-react";
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
type Period = { id: string; period_label: string; period_start: string; amount_due: number; bill_id: string | null; status: string };
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
  // picked = month starts ("YYYY-MM-01") chosen for this bill
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [monthly, setMonthly] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
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
    setPicked(new Set()); setPeriods([]); setMonthly("");
    if (!flatId) return;
    let live = true;
    setPeriodsLoading(true);
    supabase.from("maintenance_periods").select("id, period_label, period_start, amount_due, bill_id, status")
      .eq("flat_id", flatId).order("period_start")
      .then(({ data }) => {
        if (!live) return;
        const rows = ((data as any[]) ?? []).map((p) => ({ ...p, amount_due: Number(p.amount_due) })) as Period[];
        setPeriods(rows);
        const last = rows[rows.length - 1];
        if (last) setMonthly(String(last.amount_due));
        setPeriodsLoading(false);
      });
    return () => { live = false; };
  }, [flatId]);

  const validCharges = charges.filter((c) => c.description.trim() && Number(c.amount) > 0);
  const byMonth = useMemo(() => new Map(periods.map((p) => [p.period_start.slice(0, 10), p])), [periods]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, "0")}-01`), [year]);
  const monthAmount = (start: string) => {
    const p = byMonth.get(start);
    return p ? p.amount_due : Number(monthly) || 0;
  };
  const maintTotal = [...picked].reduce((s, m) => s + monthAmount(m), 0);
  const extraTotal = validCharges.reduce((s, c) => s + Number(c.amount), 0);
  const disc = Math.max(0, Math.min(Number(discount) || 0, maintTotal + extraTotal));
  const total = maintTotal + extraTotal - disc;
  const needsMonthly = [...picked].some((m) => !byMonth.has(m)) && !(Number(monthly) > 0);
  const canCreate = !!flatId && (picked.size > 0 || validCharges.length > 0) && !needsMonthly && !saving;

  function toggleMonth(start: string) {
    setPicked((prev) => { const n = new Set(prev); n.has(start) ? n.delete(start) : n.add(start); return n; });
  }

  async function submit() {
    if (!canCreate) return toast.error(tu("ln.sb.needItem"));
    setSaving(true);
    try {
      // Months without a maintenance row get one first (never overwrites an existing month).
      const periodIds: string[] = [];
      for (const m of [...picked].sort()) {
        const existing = byMonth.get(m);
        if (existing) { periodIds.push(existing.id); continue; }
        const { data: pid, error } = await supabase.rpc("ensure_maintenance_period", { _flat_id: flatId, _period_start: m, _amount: Number(monthly), _due_date: dueDate || undefined });
        if (error || !pid) throw error ?? new Error("operation_failed");
        periodIds.push(String(pid));
      }
      const { billId } = await createBill({ data: {
        flatId,
        periodIds,
        additional: validCharges.map((c) => ({ description: c.description.trim(), amount: Number(c.amount) })),
        dueDate: dueDate || null,
        notes: notes.trim() || null,
      } });
      if (billId && disc > 0 && societyId) {
        const { error: adjErr } = await (supabase as any).rpc("admin_add_bill_adjustment", {
          _society_id: societyId, _bill_id: String(billId), _amount: -disc,
          _reason: (discountReason.trim().length >= 5 ? discountReason.trim() : `Discount ${discountReason.trim()}`.trim().padEnd(5, ".")).slice(0, 500),
          _request_id: `disc-${String(billId)}`,
        });
        if (adjErr) toast.error(toSafeFinanceMessage(adjErr));
      }
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
              <section aria-labelledby="sb-per" className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 id="sb-per" className="text-sm font-semibold">{tu("ln.sb.months")}</h2>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={tu("ln.sb.prevYear")} onClick={() => setYear((y) => y - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="min-w-14 text-center text-sm font-semibold tabular-nums">{year}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={tu("ln.sb.nextYear")} onClick={() => setYear((y) => y + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sb-monthly">{tu("ln.sb.perMonth")}</Label>
                  <div className="relative max-w-48">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input id="sb-monthly" type="number" inputMode="decimal" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} className="h-11 pl-9 rounded-xl" />
                  </div>
                </div>
                {periodsLoading ? (
                  <div className="grid place-items-center py-6" role="status"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label={tu("ln.sb.months")}>
                    {months.map((m) => {
                      const p = byMonth.get(m);
                      const locked = !!p && (p.bill_id !== null || p.status === "paid");
                      const on = picked.has(m);
                      const label = new Date(`${m}T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
                      return (
                        <button key={m} type="button" disabled={locked} aria-pressed={on} onClick={() => toggleMonth(m)}
                          className={`min-h-14 rounded-xl border px-2 py-1.5 text-left text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : locked ? "border-border bg-muted text-muted-foreground" : "border-border bg-card hover:border-primary/50"}`}>
                          <span className="block font-semibold">{label}</span>
                          <span className="block text-xs tabular-nums opacity-80">{locked ? (p!.status === "paid" ? tu("ln.sb.paid") : tu("ln.sb.billed")) : monthAmount(m) > 0 ? inr(monthAmount(m)) : "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {needsMonthly && <p className="text-xs text-destructive" role="alert">{tu("ln.sb.needMonthly")}</p>}
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
                <div className="grid gap-2 pt-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-disc">{tu("ln.sb.discount")}</Label>
                    <div className="relative">
                      <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                      <Input id="sb-disc" type="number" inputMode="decimal" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-11 pl-8 rounded-xl" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-dr">{tu("ln.sb.discountReason")}</Label>
                    <Input id="sb-dr" maxLength={200} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} className="h-11 rounded-xl" />
                  </div>
                </div>
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="sb-notes">{tu("ln.sb.notes")}</Label>
                  <Input id="sb-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11 rounded-xl" />
                </div>
              </section>
            )}
          </div>

          <aside className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-20" aria-label={tu("ln.sb.total")}>
            <div className="rounded-xl bg-primary p-4 text-right text-primary-foreground">
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{tu("ln.sb.total")}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{inr(total)}</p>
              <p className="mt-1 text-xs tabular-nums opacity-85">{tu("ln.sb.maint")} {inr(maintTotal)} + {tu("ln.sb.addl")} {inr(extraTotal)}{disc > 0 ? ` − ${tu("ln.sb.discount")} ${inr(disc)}` : ""}</p>
              <p className="text-xs tabular-nums opacity-85">{picked.size} {tu("ln.sb.monthsN")} · {validCharges.length} {tu("ln.sb.chargesN")}</p>
            </div>
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
