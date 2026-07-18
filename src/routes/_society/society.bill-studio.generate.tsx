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
        toast.error((e as Error).message);
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
      toast.error((e as Error).message);
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
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/society/bill-studio" })}>
          ← Bill Studio
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><PlayCircle className="h-4 w-4" /> Ready cycles</CardTitle>
        </CardHeader>
        <CardContent>
          {sidLoading || loading ? (
            <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : readyCycles.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No cycles marked "ready". Go to Bill Studio → Cycles.</p>
          ) : (
            <ul className="space-y-2">
              {readyCycles.map((c) => (
                <li key={c.id} className="border rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.cycle_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.period_start} → {c.period_end} · Due {c.due_date}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onPreview(c.id)} disabled={busy}>
                    Preview
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {previewData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Preview — {previewData.cycle.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {previewData.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs flex items-start gap-2 text-amber-800">
                <ShieldAlert className="h-4 w-4 mt-0.5" />
                <div>Warnings: {previewData.warnings.join(", ")}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Existing bills" value={String(previewData.existing_bill_count)} />
              <StatBox label="Previous dues" value={`₹${previewData.previous_dues_total.toLocaleString("en-IN")}`} />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                disabled={busy || previewData.existing_bill_count > 0}
                onClick={() => setConfirmOpen(true)}
              >
                Finalize batch
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Recent batches</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No bill batches yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {batches.map((b) => (
                <li key={b.id} className="border rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.bills_created} bill(s) · ₹{Number(b.total_amount).toLocaleString("en-IN")}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {new Date(b.finalized_at ?? b.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={b.status === "finalized" ? "default" : "secondary"}>{b.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Finalize this batch?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will create bills for every active unit in this cycle. Bills carry structured numbers
            (RR/YYYYMM/####), current charges, previous dues and a due date. This action cannot be
            undone by regenerating — cancel individual bills instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={onFinalize} disabled={busy}>{busy ? "Finalizing…" : "Finalize"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
