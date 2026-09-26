import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, PlayCircle, ShieldAlert, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { listBillingCycles } from "@/lib/billing-config.functions";
import {
  previewBillBatch,
  finalizeBillBatch,
  listBillBatches,
  type BillBatchPreview,
} from "@/lib/billing-generate.functions";

export const Route = createFileRoute("/_society/society/bill-studio/generate")({
  head: () => ({ meta: [{ title: "Generate Bills — SociyoHub" }] }),
  component: GenerateBillsPage,
});

type Cycle = { id: string; template_id: string; cycle_name: string; period_start: string; period_end: string; due_date: string; status: string };
type Batch = { id: string; cycle_config_id: string; template_id: string; status: string; bills_created: number; total_amount: number; finalized_at: string | null; created_at: string };

function GenerateBillsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const navigate = useNavigate();
  const listCycles = useServerFn(listBillingCycles);
  const listBatches = useServerFn(listBillBatches);
  const preview = useServerFn(previewBillBatch);
  const finalize = useServerFn(finalizeBillBatch);

  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [previewData, setPreviewData] = useState<BillBatchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const readyCycles = useMemo(() => cycles.filter((c) => c.status === "ready"), [cycles]);

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const [c, b] = await Promise.all([
          listCycles({ data: { societyId } }),
          listBatches({ data: { societyId } }),
        ]);
        setCycles((c.cycles ?? []) as Cycle[]);
        setBatches((b.batches ?? []) as Batch[]);
      } catch (e) {
        toast.error(toSafeFinanceMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [societyId, sidLoading, listCycles, listBatches]);

  async function onPreview(cycleId: string) {
    if (!societyId) return;
    setBusy(true);
    setSelected(cycleId);
    try {
      const res = await preview({ data: { societyId, cycleConfigId: cycleId, limit: 200 } });
      setPreviewData(res.preview);
    } catch (e) {
      toast.error(toSafeFinanceMessage(e));
      setPreviewData(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFinalize() {
    if (!societyId || !selected) return;
    setBusy(true);
    try {
      // Stable idempotency key per (society, cycle) attempt session
      const requestId = `${selected}:${crypto.randomUUID()}`;
      const res = await finalize({ data: { societyId, cycleConfigId: selected, requestId } });
      const r = res.result;
      toast.success(
        r.idempotent_replay
          ? `Idempotent replay — ${r.bills_created} bill(s), ₹${r.total_amount.toLocaleString("en-IN")}`
          : `Generated ${r.bills_created} bill(s), ₹${r.total_amount.toLocaleString("en-IN")}`,
      );
      setConfirmOpen(false);
      setPreviewData(null);
      const b = await listBatches({ data: { societyId } });
      setBatches((b.batches ?? []) as Batch[]);
    } catch (e) {
      toast.error(toSafeFinanceMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const blockers: string[] = [];
  if (previewData) {
    if (previewData.existing_bill_count > 0) blockers.push(`${previewData.existing_bill_count} bill(s) already exist for this cycle — cancel individual bills instead of regenerating.`);
    if (previewData.unit_count === 0) blockers.push("No houses are set up to bill.");
    if (previewData.warnings.includes("cycle_not_ready")) blockers.push("This cycle is not marked ready.");
    if (previewData.warnings.includes("template_not_active")) blockers.push("The bill template is not active.");
  }
  const otherWarnings = previewData?.warnings.filter((w) => w !== "cycle_not_ready" && w !== "template_not_active") ?? [];
  const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
  const step = previewData ? 2 : 1;

  return (
    <div className="container-page space-y-6 py-6 pb-24 md:py-10">
      <button onClick={() => navigate({ to: "/society/bill-studio" })} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        ← Bill Studio
      </button>

      <header className="space-y-3 border-b border-border pb-5">
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Generate bills</h1>
        <p className="text-sm text-muted-foreground">Pick a ready cycle, review the totals, then create bills. Nothing is created until you confirm.</p>
        <ol className="flex gap-2 text-xs" aria-label="Progress">
          {["Choose cycle", "Review", "Create"].map((l, i) => (
            <li key={l} className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${i + 1 === step ? "bg-primary text-primary-foreground" : i + 1 < step ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              <span className="font-semibold">{i + 1}</span>{l}
            </li>
          ))}
        </ol>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        <section className="space-y-2" aria-label="Ready cycles">
          <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold"><PlayCircle className="h-4 w-4" />Ready cycles</h2>
          {sidLoading || loading ? (
            <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : readyCycles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No cycles are marked ready.
              <div className="mt-3"><Button variant="outline" className="min-h-11" onClick={() => navigate({ to: "/society/bill-studio" })}>Set up a cycle</Button></div>
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {readyCycles.map((c) => {
                const active = selected === c.id && !!previewData;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => onPreview(c.id)}
                      disabled={busy}
                      aria-pressed={active}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 ${active ? "bg-primary/5" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.cycle_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.period_start} → {c.period_end} · due {c.due_date}</span>
                      </span>
                      <span className={`text-sm font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
                        {busy && selected === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? "Selected" : "Review →"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-label="Review">
          <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold"><FileText className="h-4 w-4" />Review</h2>
          {!previewData ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Choose a cycle to see what will be billed.</div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{previewData.cycle.name}</p>
                <Badge variant="outline">Preview only</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total payable</p>
                <p className="text-3xl font-bold tabular-nums">{inr(previewData.total_payable)}</p>
                <p className="text-xs text-muted-foreground">{previewData.unit_count} houses · due {previewData.cycle.due_date}</p>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border text-sm">
                <StatBox label="Current charges" value={inr(previewData.current_charges_total)} />
                <StatBox label="Previous dues" value={inr(previewData.previous_dues_total)} />
              </dl>
              {blockers.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-destructive"><ShieldAlert className="h-4 w-4" />Can't create bills yet</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              {otherWarnings.length > 0 && (
                <p className="rounded-xl bg-warning/10 p-3 text-xs">Warnings: {otherWarnings.join(", ")}</p>
              )}
              <Button className="min-h-12 w-full" disabled={busy || blockers.length > 0} onClick={() => setConfirmOpen(true)}>
                Create {previewData.unit_count} bills
              </Button>
            </div>
          )}
        </section>
      </div>

      <section className="space-y-2" aria-label="Recent batches">
        <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold"><Receipt className="h-4 w-4" />Recent batches</h2>
        {batches.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No bill batches yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
            {batches.map((b) => (
              <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{b.bills_created} bill(s) · <span className="tabular-nums">{inr(b.total_amount)}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{new Date(b.finalized_at ?? b.created_at).toLocaleString("en-IN")}</div>
                </div>
                <Badge variant={b.status === "finalized" ? "default" : "secondary"} className="capitalize">{b.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create these bills?</DialogTitle></DialogHeader>
          {previewData && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1 rounded-xl border p-3">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Bills to create</span><span className="font-semibold">{previewData.unit_count}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Period</span><span>{previewData.cycle.period_start} → {previewData.cycle.period_end}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">Due date</span><span>{previewData.cycle.due_date}</span></div>
                <div className="mt-1 flex justify-between gap-3 border-t pt-1"><span className="font-medium">Total payable</span><span className="font-semibold tabular-nums">{inr(previewData.total_payable)}</span></div>
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                <li>Bill numbers are assigned when bills are created.</li>
                <li>No payments are recorded in this step.</li>
                <li>You can't regenerate once bills exist — cancel individual bills instead.</li>
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button className="min-h-11" onClick={onFinalize} disabled={busy}>{busy ? "Creating…" : "Create bills"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
