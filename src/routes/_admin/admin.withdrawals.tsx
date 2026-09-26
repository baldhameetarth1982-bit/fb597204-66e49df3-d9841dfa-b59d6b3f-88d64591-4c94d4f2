import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Banknote, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { EmptyState } from "@/components/system/EmptyState";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/withdrawals")({
  head: () => ({ meta: [{ title: "Withdrawals — Admin" }] }),
  component: WithdrawalsAdmin,
});

interface Row {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  upi_id: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  status: string;
  created_at: string;
  profile?: { full_name: string | null; email: string | null } | null;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const FILTERS = [
  { key: "pending", label: "Waiting" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
] as const;
const tone = (s: string) => (s === "paid" ? "success" : s === "rejected" ? "danger" : s === "pending" ? "warning" : "neutral") as any;

function WithdrawalsAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("pending");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; status: "paid" | "rejected" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    let q = supabase
      .from("withdrawals")
      .select("id, user_id, amount, method, upi_id, bank_account, bank_ifsc, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) { setFailed(true); setLoading(false); return; }
    const list = (data as Row[]) ?? [];
    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
      list.forEach((r) => (r.profile = map.get(r.user_id) ?? null));
    }
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    if (!confirm) return;
    setBusy(true);
    const { error } = await supabase.from("withdrawals").update({ status: confirm.status }).eq("id", confirm.row.id);
    setBusy(false);
    setConfirm(null);
    if (error) return toast.error(error.message);
    toast.success(confirm.status === "paid" ? "Marked paid" : "Request rejected");
    void load();
  }

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <PageShell>
      <PageHeader title="Withdrawals" description="Review and pay out referral commissions." />

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div role="tablist" className="flex w-fit gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${filter === f.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!loading && !failed && rows.length > 0 && (
          <p className="text-right text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{fmt.format(total)}</span> · {rows.length}</p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : failed ? (
        <ErrorState onRetry={load} showSupport={false} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Banknote} title={filter === "pending" ? "Nothing waiting" : "No requests"} description={filter === "pending" ? "New withdrawal requests will appear here." : undefined} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((r) => {
            const isOpen = open === r.id;
            return (
              <li key={r.id}>
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.profile?.full_name || "Unknown"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.method === "upi" ? "UPI" : "Bank"} · {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{fmt.format(Number(r.amount))}</p>
                    <StatusChip tone={tone(r.status)} className="mt-0.5 capitalize">{r.status}</StatusChip>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Email</dt><dd className="truncate">{r.profile?.email ?? "—"}</dd>
                      {r.method === "upi" ? (
                        <><dt className="text-muted-foreground">UPI</dt><dd className="truncate">{r.upi_id ?? "—"}</dd></>
                      ) : (
                        <>
                          <dt className="text-muted-foreground">Account</dt><dd className="truncate tabular-nums">{r.bank_account ?? "—"}</dd>
                          <dt className="text-muted-foreground">IFSC</dt><dd className="truncate">{r.bank_ifsc ?? "—"}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">Requested</dt><dd>{new Date(r.created_at).toLocaleString("en-IN")}</dd>
                    </dl>
                    {r.status === "pending" && (
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                        <Button variant="outline" className="h-11 rounded-xl" onClick={() => setConfirm({ row: r, status: "rejected" })}>
                          <XCircle className="mr-1 h-4 w-4" /> Reject
                        </Button>
                        <Button className="h-11 rounded-xl" onClick={() => setConfirm({ row: r, status: "paid" })}>
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Mark paid
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.status === "paid" ? "Mark as paid?" : "Reject this request?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && `${fmt.format(Number(confirm.row.amount))} to ${confirm.row.profile?.full_name || "this user"}.`}{" "}
              {confirm?.status === "paid" ? "Only do this after the money has been sent." : "The user will see the request as rejected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void apply(); }} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {confirm?.status === "paid" ? "Mark paid" : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
