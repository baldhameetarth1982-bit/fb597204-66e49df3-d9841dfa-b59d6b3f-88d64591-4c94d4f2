import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Receipt, Plus, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { SummaryStrip, ListSkeleton, SearchField, SegmentedFilter, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { toast } from "sonner";
import { shareBillAsImage } from "@/components/billing/BillCardImage";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/billing/")({
  head: () => ({ meta: [{ title: "Bill History — SociyoHub" }] }),
  component: BillingPage,
});

interface BillRow {
  id: string;
  period_label: string;
  amount: number;
  due_date: string;
  status: string;
  flat_id: string;
  flat: { flat_number: string; block: { name: string } | null } | null;
}

function BillingPage() {
  const { user } = useAuth();
  const { societyId, loading: sidLoading } = useSocietyId();
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid" | "overdue" | "cancelled">("all");

  const loadCtl = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => () => loadCtl.current?.abort(), []);

  async function load() {
    if (!societyId) { setLoading(false); return; }
    loadCtl.current?.abort();
    const ctl = new AbortController();
    loadCtl.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 20000);
    const stale = () => loadCtl.current !== ctl;
    setLoading(true);
    setLoadError(null);
    try {
    const { data, error } = await supabase
      .from("bills")
      .select("id, period_label, amount, due_date, status, flat_id")
      .eq("society_id", societyId)
      .order("due_date", { ascending: false })
      .limit(500)
      .abortSignal(ctl.signal);
    if (stale()) return;
    if (error) { setRows([]); setLoadError(toSafeFinanceError(error).message); setLoading(false); return; }
    const bills = (data as any[]) ?? [];
    const flatIds = Array.from(new Set(bills.map((b) => b.flat_id).filter(Boolean)));
    let flatMap: Record<string, { flat_number: string; block_id: string | null }> = {};
    let blockMap: Record<string, string> = {};
    if (flatIds.length) {
      const { data: flats } = await supabase.from("flats").select("id, flat_number, block_id").in("id", flatIds).abortSignal(ctl.signal);
      if (stale()) return;
      flatMap = Object.fromEntries((flats ?? []).map((f: any) => [f.id, { flat_number: f.flat_number, block_id: f.block_id }]));
      const blockIds = Array.from(new Set((flats ?? []).map((f: any) => f.block_id).filter(Boolean)));
      if (blockIds.length) {
        const { data: blocks } = await supabase.from("blocks").select("id, name").in("id", blockIds).abortSignal(ctl.signal);
        if (stale()) return;
        blockMap = Object.fromEntries((blocks ?? []).map((b: any) => [b.id, b.name]));
      }
    }
    setRows(bills.map((b) => {
      const f = flatMap[b.flat_id];
      return { ...b, flat: f ? { flat_number: f.flat_number, block: f.block_id ? { name: blockMap[f.block_id] ?? "" } : null } : null };
    }));
    setLoading(false);
    } finally { clearTimeout(timer); }
  }

  useEffect(() => { void load(); }, [societyId]);

  const now = Date.now();
  const filtered = rows.filter((r) => {
    if (q.trim()) {
      const t = q.toLowerCase();
      const match = r.period_label.toLowerCase().includes(t) ||
        r.flat?.flat_number.toLowerCase().includes(t) ||
        r.flat?.block?.name?.toLowerCase().includes(t);
      if (!match) return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "overdue") return r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date).getTime() < now;
    return r.status === statusFilter;
  });

  const counts = {
    all: rows.length,
    paid: rows.filter((r) => r.status === "paid").length,
    unpaid: rows.filter((r) => r.status === "unpaid").length,
    overdue: rows.filter((r) => r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date).getTime() < now).length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
  };
  const collected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount || 0), 0);
  const statsReady = !sidLoading && !loading && !loadError;
  const outstanding = rows.filter((r) => r.status !== "paid" && r.status !== "cancelled").reduce((s, r) => s + Number(r.amount || 0), 0);

  const FILTERS: Array<{ key: typeof statusFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "unpaid", label: "Pending", count: counts.unpaid },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "paid", label: "Paid", count: counts.paid },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

  const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  async function share(r: BillRow, flatLabel: string) {
    try {
      await shareBillAsImage({
        societyName: "Society Bill", flatLabel, period: r.period_label,
        amount: Number(r.amount), dueDate: new Date(r.due_date).toLocaleDateString(),
        status: (r.status as any) || "due", adminSignature: user?.email?.split("@")[0],
      });
    } catch { toast.error(tu("op.could_not_share_this_bill")); }
  }
  async function cancel(r: BillRow) {
    const reason = window.prompt("Reason for cancellation?");
    if (!reason || cancelling) return;
    setCancelling(r.id);
    const { error } = await supabase.rpc("cancel_bill", { _bill_id: r.id, _reason: reason });
    setCancelling(null);
    if (error) toast.error(toSafeFinanceError(error).message);
    else { toast.success(tu("op.bill_cancelled")); void load(); }
  }

  return (
    <PageShell>
      <PageHeader
        title={tu("op.bill_history")}
        description={tu("op.every_generated_bill_for_every")}
        actions={<Button asChild className="min-h-11 rounded-xl"><Link to="/society/billing/generate"><Plus className="h-4 w-4 mr-1" />{tu("op.generate_bills")}</Link></Button>}
      />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>

      <SummaryStrip items={[
        { label: "Outstanding", value: statsReady ? money(outstanding) : "—", hint: statsReady ? `${counts.unpaid + counts.overdue} open bills` : undefined },
        { label: "Overdue bills", value: statsReady ? counts.overdue : "—" },
        { label: "Paid (bill totals)", value: statsReady ? money(collected) : "—", hint: statsReady ? `${counts.paid} bills` : undefined },
        { label: "Total bills", value: statsReady ? counts.all : "—", hint: "Latest 500" },
      ]} />

      {sidLoading || loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <LoadError title={loadError} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <ListEmpty icon={Receipt} title={tu("rbills.none")}>{tu("op.generate_your_first_monthly_maintenance")}</ListEmpty>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchField label={tu("op.search_bills")} placeholder={tu("op.house_or_period")} value={q} onChange={setQ} />
            <SegmentedFilter<typeof statusFilter> label={tu("op.bill_status")} value={statusFilter} onChange={setStatusFilter} options={FILTERS} />
          </div>

          {filtered.length === 0 ? (
            <ListEmpty icon={Receipt} title={tu("op.no_matching_bills")}>{tu("op.try_a_different_search_or")}</ListEmpty>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_120px_120px_130px] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden>
                <span>{tu("gd.houseLabel")}</span><span>{tu("inc.period")}</span><span>{tu("bills.due")}</span><span>{tu("common.status")}</span><span className="text-right">{tu("common.amount")}</span>
              </div>
              <ul className="divide-y divide-border">
                {filtered.map((r) => {
                  const overdue = r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date).getTime() < now;
                  const tone = r.status === "paid" ? "success" : r.status === "cancelled" ? "neutral" : overdue ? "danger" : "warning";
                  const label = r.status === "paid" ? "Paid" : r.status === "cancelled" ? "Cancelled" : overdue ? "Overdue" : "Pending";
                  const flatLabel = `${r.flat?.block?.name ? r.flat.block.name + "-" : ""}${r.flat?.flat_number ?? "—"}`;
                  const open = r.status !== "paid" && r.status !== "cancelled";
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <Link to="/society/bills/$id" params={{ id: r.id }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_120px_120px_130px]">
                        <span className="truncate font-semibold">{tu("gd.houseLabel")} {flatLabel}</span>
                        <span className={`text-right font-semibold tabular-nums md:order-last ${r.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>{money(Number(r.amount))}</span>
                        <span className="truncate text-sm text-muted-foreground md:text-foreground">{r.period_label}</span>
                        <span className="text-right text-xs text-muted-foreground md:text-left md:text-sm">{tu("bills.due")} {new Date(r.due_date).toLocaleDateString("en-IN")}</span>
                        <span className="col-span-2 md:col-span-1"><StatusChip tone={tone}>{label}</StatusChip></span>
                      </Link>
                      <div className="mt-2 flex gap-1">
                        <Button variant="ghost" size="sm" className="min-h-11 text-xs" onClick={() => void share(r, flatLabel)} aria-label={`Share bill for house ${flatLabel}`}><Share2 className="mr-1 h-3.5 w-3.5" />{tu("prof.share")}</Button>
                        {open && <Button variant="ghost" size="sm" className="min-h-11 text-xs text-destructive" disabled={cancelling !== null} onClick={() => void cancel(r)} aria-label={`Cancel bill for house ${flatLabel}`}>{tu("op.cancel_bill")}</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
