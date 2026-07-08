import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2, ArrowLeft, FilePlus2, IndianRupee, CalendarDays,
  Users, Building2, Info, AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/system/StatusChip";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/billing/generate")({
  head: () => ({ meta: [{ title: "Generate Bills — SocioHub" }] }),
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

  // Form
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
  });
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
      const list: FlatSummary[] = ((flatsRes.data as any[]) ?? []).map((f) => ({
        id: f.id,
        flat_number: f.flat_number,
        block_id: f.block_id,
        block_name: f.block_id ? blockMap[f.block_id] ?? null : null,
        has_resident: occupiedFlats.has(f.id),
      }));
      setFlats(list);
      setLoading(false);
    })();
  }, [societyId, sidLoading]);

  const billable = useMemo(() => flats.filter((f) => f.block_id && f.has_resident), [flats]);
  const totalAmount = billable.length * (Number(amount) || 0);

  async function generate() {
    if (!societyId) return;
    const amt = Number(amount);
    if (!period.trim() || !amt || !dueDate) {
      return toast.error("Fill all fields");
    }
    if (!billable.length) {
      return toast.error("No billable flats. Assign residents to flats before generating bills.");
    }
    setGenerating(true);
    const due = new Date(dueDate);
    const start = new Date(due.getFullYear(), due.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(due.getFullYear(), due.getMonth() + 1, 0).toISOString().slice(0, 10);
    const payload = billable.map((f) => ({
      society_id: societyId,
      flat_id: f.id,
      period_label: period.trim(),
      period_start: start,
      period_end: end,
      amount: amt,
      due_date: dueDate,
      status: "unpaid",
    }));
    const { error } = await supabase.from("bills").insert(payload);
    setGenerating(false);
    if (error) return toast.error(error.message);
    toast.success(`Generated ${payload.length} bill${payload.length === 1 ? "" : "s"}`);
    navigate({ to: "/society/billing" });
  }

  if (sidLoading || loading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <PageShell>
      <BillingCenterTabs />
      <PageHeader
        title="Generate bills"
        description="Bulk bill generation — one bill per occupied flat in your society."
      />

      {flats.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No flats yet"
          description="Set up blocks and flats before generating bills."
        />
      ) : billable.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No occupied flats"
          description="Assign residents to flats first. Only flats with an active resident receive bills."
        />
      ) : (
        <>
          <Card className="rounded-2xl mb-4">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                <Info className="h-4 w-4 text-primary" />
                <span>Bills will be generated for <b className="text-foreground">{billable.length}</b> occupied flat{billable.length === 1 ? "" : "s"}.</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Period label</Label>
                  <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="June 2026" className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount per flat (₹)</Label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-9 rounded-xl" />
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Due date</Label>
                  <div className="relative">
                    <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="pl-9 rounded-xl" />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between rounded-xl bg-muted/50 px-4 py-3">
                <span className="text-xs text-muted-foreground">Estimated total</span>
                <span className="text-lg font-bold inline-flex items-baseline">
                  <IndianRupee className="h-4 w-4" />{totalAmount.toLocaleString("en-IN")}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl mb-4">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Occupied flats preview</p>
                <StatusChip tone="primary">{billable.length} flats</StatusChip>
              </div>
              <div className="grid gap-1.5 max-h-80 overflow-y-auto">
                {billable.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="font-medium">
                      {f.block_name ? `${f.block_name}-` : ""}{f.flat_number}
                    </span>
                    <StatusChip tone="success">Occupied</StatusChip>
                  </div>
                ))}
              </div>
              {flats.length - billable.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {flats.length - billable.length} flat{flats.length - billable.length === 1 ? " is" : "s are"} vacant or unassigned to a block and will be skipped.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="sticky bottom-4 flex gap-2 pb-4">
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-1.5" />Cancel</Link>
            </Button>
            <Button onClick={generate} disabled={generating} className="rounded-xl flex-1 h-11">
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePlus2 className="h-4 w-4 mr-2" />}
              Generate {billable.length} bill{billable.length === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
    </PageShell>
  );
}
