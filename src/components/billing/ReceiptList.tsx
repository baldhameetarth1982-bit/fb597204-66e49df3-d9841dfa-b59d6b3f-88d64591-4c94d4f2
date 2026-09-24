import { useEffect, useMemo, useState } from "react";
import { Receipt, Search, CheckCircle2, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { EmptyState } from "@/components/shared/PageHeader";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import { formatDate } from "@/utils/format";

type Row = {
  id: string;
  receipt_number: string;
  status: string;
  issued_at: string | null;
  verified_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  amount_snapshot: number | null;
  method_snapshot: string | null;
  reference_snapshot: string | null;
  bill_number_snapshot: string | null;
  home: string | null;
};

const INR = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { cash: "Cash", bank_transfer: "Bank Transfer" };

/**
 * Receipts are only created by the canonical verify RPC, so every row here
 * is a verified payment. Voided receipts (payment reversed) stay visible and
 * are clearly marked — history is never hidden or deleted.
 * Access is enforced by RLS: residents see their own home's receipts;
 * committee members with billing permission see their society's.
 */
export function ReceiptList({ societyId, showHome }: { societyId?: string | null; showHome: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("payment_receipts")
        .select("id, payment_id, receipt_number, status, issued_at, verified_at, voided_at, void_reason, amount_snapshot, method_snapshot, reference_snapshot, bill_number_snapshot")
        .order("issued_at", { ascending: false })
        .limit(300);
      if (societyId) query = query.eq("society_id", societyId);
      const { data, error: err } = await query;
      if (err) throw err;
      const list = data ?? [];
      const homes: Record<string, string> = {};
      if (showHome && list.length) {
        const { data: pays } = await supabase.from("payments").select("id, flat_id").in("id", list.map((r) => r.payment_id));
        const flatIds = Array.from(new Set((pays ?? []).map((p) => p.flat_id).filter(Boolean))) as string[];
        const { data: flats } = flatIds.length
          ? await supabase.from("flats").select("id, flat_number").in("id", flatIds)
          : { data: [] as { id: string; flat_number: string }[] };
        const fl: Record<string, string> = Object.fromEntries((flats ?? []).map((f) => [f.id, f.flat_number]));
        for (const p of pays ?? []) if (p.flat_id && fl[p.flat_id]) homes[p.id] = fl[p.flat_id];
      }
      setRows(list.map((r) => ({ ...r, home: homes[r.payment_id] ?? null })));
    } catch (e) {
      setRows([]);
      setError(toSafeFinanceError(e).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [societyId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.receipt_number, r.bill_number_snapshot, r.reference_snapshot, r.home].some((v) => v?.toLowerCase().includes(t)));
  }, [rows, q]);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading receipts">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 bg-card p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No receipts yet"
        description="A receipt is issued only after the committee verifies a Cash or Bank Transfer payment. Pending payments don't have receipts."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search receipts" placeholder={showHome ? "Search receipt, bill, house or reference" : "Search receipt or bill number"} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 rounded-xl h-11" />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No receipts match this search.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            const voided = r.status === "voided" || !!r.voided_at;
            return (
              <li key={r.id} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Receipt</p>
                    <p className={`font-semibold break-all ${voided ? "line-through text-muted-foreground" : ""}`}>{r.receipt_number}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[showHome && r.home ? `House ${r.home}` : null, r.bill_number_snapshot ? `Bill ${r.bill_number_snapshot}` : null,
                        r.method_snapshot ? (METHOD[r.method_snapshot] ?? r.method_snapshot) : null].filter(Boolean).join(" · ")}
                    </p>
                    {r.reference_snapshot && <p className="text-xs text-muted-foreground break-all">Ref: {r.reference_snapshot}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums">{r.amount_snapshot != null ? INR(Number(r.amount_snapshot)) : "—"}</p>
                    {voided ? (
                      <StatusChip tone="neutral" icon={<Ban className="h-3 w-3" />} className="mt-1">Voided</StatusChip>
                    ) : (
                      <StatusChip tone="success" icon={<CheckCircle2 className="h-3 w-3" />} className="mt-1">Verified</StatusChip>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Issued {r.issued_at ? formatDate(r.issued_at) : "—"}
                  {voided && r.voided_at ? ` · Voided ${formatDate(r.voided_at)} after payment reversal` : ""}
                  {voided && r.void_reason ? ` · ${r.void_reason}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
