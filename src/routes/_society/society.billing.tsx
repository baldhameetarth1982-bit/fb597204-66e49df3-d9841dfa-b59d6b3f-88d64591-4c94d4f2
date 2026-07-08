import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Receipt, Loader2, Plus, IndianRupee, Search, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { shareBillAsImage } from "@/components/billing/BillCardImage";

export const Route = createFileRoute("/_society/society/billing")({
  head: () => ({ meta: [{ title: "Bill History — SocioHub" }] }),
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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid" | "overdue" | "cancelled">("all");

  async function load() {
    if (!societyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("bills")
      .select("id, period_label, amount, due_date, status, flat_id")
      .eq("society_id", societyId)
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const bills = (data as any[]) ?? [];
    const flatIds = Array.from(new Set(bills.map((b) => b.flat_id).filter(Boolean)));
    let flatMap: Record<string, { flat_number: string; block_id: string | null }> = {};
    let blockMap: Record<string, string> = {};
    if (flatIds.length) {
      const { data: flats } = await supabase
        .from("flats")
        .select("id, flat_number, block_id")
        .in("id", flatIds);
      flatMap = Object.fromEntries((flats ?? []).map((f: any) => [f.id, { flat_number: f.flat_number, block_id: f.block_id }]));
      const blockIds = Array.from(new Set((flats ?? []).map((f: any) => f.block_id).filter(Boolean)));
      if (blockIds.length) {
        const { data: blocks } = await supabase.from("blocks").select("id, name").in("id", blockIds);
        blockMap = Object.fromEntries((blocks ?? []).map((b: any) => [b.id, b.name]));
      }
    }
    setRows(bills.map((b) => {
      const f = flatMap[b.flat_id];
      return {
        ...b,
        flat: f ? { flat_number: f.flat_number, block: f.block_id ? { name: blockMap[f.block_id] ?? "" } : null } : null,
      };
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [societyId]);

  const now = Date.now();

  const filtered = rows.filter((r) => {
    if (q.trim()) {
      const t = q.toLowerCase();
      const match =
        r.period_label.toLowerCase().includes(t) ||
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

  if (sidLoading || loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const FILTERS: Array<{ key: typeof statusFilter; label: string }> = [
    { key: "all", label: `All (${counts.all})` },
    { key: "unpaid", label: `Pending (${counts.unpaid})` },
    { key: "overdue", label: `Overdue (${counts.overdue})` },
    { key: "paid", label: `Paid (${counts.paid})` },
    { key: "cancelled", label: `Cancelled (${counts.cancelled})` },
  ];

  return (
    <PageShell>
      <BillingCenterTabs />
      <PageHeader
        title="Bill History"
        description="Track every generated bill and its payment status."
        actions={
          <Button asChild className="rounded-xl h-11">
            <Link to="/society/billing/generate">
              <Plus className="h-4 w-4 mr-2" />
              Generate bills
            </Link>
          </Button>
        }
      />


      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills yet"
          description="Generate your first monthly maintenance bill for all flats."
        />
      ) : (
        <>
          <div className="relative mb-3 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by flat or period"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>

          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Receipt} title="No matching bills" description="Try a different filter or search term." />
          ) : (
            <div className="grid gap-2 pb-24">
              {filtered.map((r) => {
                const overdue = r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date).getTime() < now;
                const tone =
                  r.status === "paid" ? "success" :
                  r.status === "cancelled" ? "neutral" :
                  overdue ? "danger" : "warning";
                const label = r.status === "unpaid" && overdue ? "OVERDUE" : r.status.toUpperCase();
                const flatLabel = `${r.flat?.block?.name ? r.flat.block.name + "-" : ""}${r.flat?.flat_number ?? "—"}`;
                return (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <Link
                      to="/society/bills/$id"
                      params={{ id: r.id }}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold truncate">{flatLabel}</p>
                          <StatusChip tone={tone}>{label}</StatusChip>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{r.period_label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Due {new Date(r.due_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="inline-flex items-baseline text-lg font-bold">
                          <IndianRupee className="h-4 w-4" />{Number(r.amount).toLocaleString("en-IN")}
                        </p>
                        <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
                      </div>
                    </Link>
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg h-8 text-xs"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            await shareBillAsImage({
                              societyName: "Society Bill",
                              flatLabel,
                              period: r.period_label,
                              amount: Number(r.amount),
                              dueDate: new Date(r.due_date).toLocaleDateString(),
                              status: (r.status as any) || "due",
                              adminSignature: user?.email?.split("@")[0],
                            });
                          } catch (err: any) { toast.error(err?.message ?? "Could not share"); }
                        }}
                      >
                        Share
                      </Button>
                      {r.status !== "paid" && r.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg h-8 text-xs text-destructive"
                          onClick={async (e) => {
                            e.preventDefault();
                            const reason = window.prompt("Reason for cancellation?");
                            if (!reason) return;
                            const { error } = await supabase.rpc("cancel_bill", { _bill_id: r.id, _reason: reason });
                            if (error) toast.error(error.message);
                            else { toast.success("Bill cancelled"); load(); }
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

