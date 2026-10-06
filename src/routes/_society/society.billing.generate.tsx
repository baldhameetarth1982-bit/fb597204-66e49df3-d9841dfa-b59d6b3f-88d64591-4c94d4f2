import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2, ArrowLeft, FilePlus2, IndianRupee, CalendarDays,
  Users, Building2, Info, AlertCircle, Receipt,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState, PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/system/StatusChip";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/billing/generate")({
  head: () => ({ meta: [{ title: "Generate Bills — SociyoHub" }] }),
  component: GenerateBillsPage,
});

interface FlatSummary {
  id: string;
  flat_number: string;
  block_id: string | null;
  block_name?: string | null;
  has_resident: boolean;
}

function GenerateBillsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const navigate = useNavigate();
  const [flats, setFlats] = useState<FlatSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState(() =>
    new Date().toLocaleString("en-IN", { month: "long", year: "numeric" }),
  );
  const [amount, setAmount] = useState("2500");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  });
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [flatsRes, blocksRes, residentsRes] = await Promise.all([
        supabase.from("flats").select("id, flat_number, block_id").eq("society_id", societyId),
        supabase.from("blocks").select("id, name").eq("society_id", societyId),
        supabase.from("flat_residents").select("flat_id").is("moved_out_at", null),
      ]);
      const blockMap: Record<string, string> = Object.fromEntries(
        ((blocksRes.data as any[]) ?? []).map((b) => [b.id, b.name]),
      );
      const occupiedFlats = new Set(((residentsRes.data as any[]) ?? []).map((r) => r.flat_id));
      setFlats(((flatsRes.data as any[]) ?? []).map((f) => ({
        id: f.id, flat_number: f.flat_number, block_id: f.block_id,
        block_name: f.block_id ? blockMap[f.block_id] ?? null : null,
        has_resident: occupiedFlats.has(f.id),
      })));
      setLoading(false);
    })();
  }, [societyId, sidLoading]);

  const billable = useMemo(() => flats.filter((f) => f.block_id && f.has_resident), [flats]);
  const totalAmount = billable.length * (Number(amount) || 0);

  const skipped = useMemo(() => flats.filter((f) => !(f.block_id && f.has_resident)), [flats]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; count?: number; message?: string } | null>(null);
  const configValid = !!period.trim() && Number(amount) > 0 && !!dueDate;
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const dueLabel = dueDate ? new Date(dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const dueInPast = dueDate ? new Date(dueDate).getTime() < new Date(new Date().toDateString()).getTime() : false;
  const houseLabel = (f: FlatSummary) => `${f.block_name ? `${f.block_name}-` : ""}${f.flat_number}`;

  async function generate() {
    if (!societyId || generating) return;
    const amt = Number(amount);
    if (!period.trim() || !amt || !dueDate) return toast.error(tu("op.fill_all_fields"));
    if (!billable.length) return toast.error(tu("op.no_billable_flats_assign_residents"));
    setGenerating(true);
    setStep(3);
    const due = new Date(dueDate);
    const start = new Date(due.getFullYear(), due.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(due.getFullYear(), due.getMonth() + 1, 0).toISOString().slice(0, 10);
    const payload = billable.map((f) => ({
      society_id: societyId, flat_id: f.id,
      period_label: period.trim(),
      period_start: start, period_end: end,
      amount: amt, due_date: dueDate, status: "unpaid",
    }));
    const { error } = await supabase.from("bills").insert(payload);
    setGenerating(false);
    if (error) {
      const message = error.message?.includes("approval_required")
        ? "This society requires a second approver. Create bills from Bill Studio → Generate so the run can be reviewed and approved."
        : toSafeFinanceMessage(error, "Could not generate bills. Please try again.");
      setResult({ ok: false, message });
      return toast.error(message);
    }
    setResult({ ok: true, count: payload.length });
    toast.success(`Generated ${payload.length} bill${payload.length === 1 ? "" : "s"}`);
  }

  const STEPS = ["Configure", "Review", "Generate"] as const;

  return (
    <PageShell>
      <PageHeader title={tu("op.generate_bills")} description={tu("op.create_one_maintenance_bill_for")} />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>

      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label={tu("op.steps")}>
        {STEPS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const state = step === n ? "current" : step > n ? "done" : "todo";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined}
              className={`rounded-xl border px-3 py-2 text-sm ${state === "current" ? "border-foreground bg-card font-semibold" : state === "done" ? "border-border bg-success-container text-success-container-foreground" : "border-border text-muted-foreground"}`}>
              <span className="block text-xs opacity-70">{tu("op.step")} {n}</span>{label}
            </li>
          );
        })}
      </ol>

      {sidLoading || loading ? (
        <div className="min-h-[30vh] grid place-items-center" role="status" aria-label={tu("op.loading_houses")}><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : flats.length === 0 ? (
        <EmptyState icon={Building2} title={tu("op.no_houses_yet")} description={tu("op.set_up_blocks_and_houses")} />
      ) : billable.length === 0 ? (
        <EmptyState icon={Users} title={tu("op.no_occupied_houses")} description={tu("op.assign_residents_to_houses_first")} />
      ) : step === 1 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <section aria-labelledby="cfg-h" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="cfg-h" className="mb-4 font-semibold">{tu("op.bill_settings")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="g-period">{tu("op.bill_period")}</Label>
                <Input id="g-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={tu("op.june_2026")} className="h-11 rounded-xl" />
                <p className="text-xs text-muted-foreground">{tu("op.shown_on_every_bill_e")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-amt">{tu("op.amount_per_house")}</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="g-amt" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-due">{tu("rbd.dueDate")}</Label>
                <div className="relative">
                  <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="g-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11 pl-9 rounded-xl" />
                </div>
              </div>
            </div>
            {!configValid && <p className="mt-4 text-sm text-destructive" role="alert">{tu("op.enter_a_period_an_amount")}</p>}
          </section>
          <aside className="rounded-2xl border border-border bg-card p-5" aria-label={tu("op.what_will_be_generated")}>
            <p className="text-sm text-muted-foreground">{tu("op.what_will_be_generated")}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{billable.length} <span className="text-base font-normal text-muted-foreground">{tu("op.bills")}</span></p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{tu("op.per_house")}</dt><dd className="tabular-nums">{Number(amount) > 0 ? inr(Number(amount)) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{tu("op.total_billed")}</dt><dd className="font-semibold tabular-nums">{Number(amount) > 0 ? inr(totalAmount) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{tu("op.skipped_houses")}</dt><dd className="tabular-nums">{skipped.length}</dd></div>
            </dl>
            <Button className="mt-5 h-11 w-full rounded-xl" disabled={!configValid} onClick={() => { setConfirmed(false); setStep(2); }}>{tu("op.review_bills")}</Button>
          </aside>
        </div>
      ) : step === 2 ? (
        <div className="space-y-5">
          <section className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4" aria-label={tu("op.summary")}>
            {[["Period", period.trim()], ["Due", dueLabel], ["Bills", String(billable.length)], ["Total", inr(totalAmount)]].map(([l, v]) => (
              <div key={l} className="bg-card px-4 py-3"><p className="text-xs text-muted-foreground">{l}</p><p className="font-semibold tabular-nums">{v}</p></div>
            ))}
          </section>

          <div className="space-y-2">
            {dueInPast && <p className="flex gap-2 rounded-xl bg-danger-container px-4 py-3 text-sm text-danger-container-foreground"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{tu("op.the_due_date_is_in")}</p>}
            <p className="flex gap-2 rounded-xl bg-warning-container px-4 py-3 text-sm text-warning-container-foreground"><Info className="h-4 w-4 shrink-0 mt-0.5" />{tu("op.generated_bills_can_t_be")}</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-labelledby="bill-h" className="rounded-2xl border border-border bg-card">
              <h2 id="bill-h" className="flex items-center justify-between border-b border-border px-4 py-3 text-sm font-semibold">{tu("op.will_be_billed")} <StatusChip tone="success">{billable.length}</StatusChip></h2>
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {billable.map((f) => (
                  <li key={f.id} className="flex items-center justify-between px-4 py-2 text-sm"><span className="font-medium">{tu("gd.houseLabel")} {houseLabel(f)}</span><span className="tabular-nums">{inr(Number(amount))}</span></li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="skip-h" className="rounded-2xl border border-border bg-card">
              <h2 id="skip-h" className="flex items-center justify-between border-b border-border px-4 py-3 text-sm font-semibold">{tu("op.will_be_skipped")} <StatusChip tone="neutral">{skipped.length}</StatusChip></h2>
              {skipped.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{tu("op.no_houses_skipped")}</p> : (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                  {skipped.map((f) => (
                    <li key={f.id} className="flex items-center justify-between px-4 py-2 text-sm"><span>{tu("gd.houseLabel")} {houseLabel(f)}</span><span className="text-xs text-muted-foreground">{!f.block_id ? tu("op.no_block") : tu("op.no_resident")}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {tu("op.i_ve_checked_the_period")} {billable.length} {tu("op.bill")}{billable.length === 1 ? "" : "s"} {tu("op.totalling")} {inr(totalAmount)}.
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1.5" />{tu("op.back_to_settings")}</Button>
            <Button className="h-11 rounded-xl" disabled={!confirmed || generating} onClick={() => void generate()}><FilePlus2 className="h-4 w-4 mr-2" />{tu("billingTabs.generate")} {billable.length} {tu("op.bill")}{billable.length === 1 ? "" : "s"}</Button>
          </div>
        </div>
      ) : (
        <section className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-6 text-center" aria-live="polite">
          {generating ? (
            <><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground" /><p className="font-semibold">{tu("op.creating_bills")}</p><p className="text-sm text-muted-foreground">{tu("op.please_keep_this_page_open")}</p></>
          ) : result?.ok ? (
            <><Receipt className="mx-auto mb-3 h-8 w-8 text-success" /><p className="font-semibold">{result.count} {tu("op.bill")}{result.count === 1 ? "" : "s"} {tu("op.created")}</p><p className="text-sm text-muted-foreground">{tu("op.residents_can_now_see_them")}</p>
              <Button className="mt-4 h-11 rounded-xl" onClick={() => navigate({ to: "/society/billing" })}>{tu("op.open_bill_history")}</Button></>
          ) : (
            <><AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" /><p className="font-semibold">{tu("op.no_bills_were_created")}</p><p className="text-sm text-muted-foreground">{result?.message}</p>
              <div className="mt-4 flex justify-center gap-2"><Button variant="outline" className="h-11 rounded-xl" onClick={() => setStep(2)}>{tu("op.back_to_review")}</Button><Button asChild variant="ghost" className="h-11 rounded-xl"><Link to="/society/billing">{tu("op.bill_history")}</Link></Button></div></>
          )}
        </section>
      )}
    </PageShell>
  );
}
