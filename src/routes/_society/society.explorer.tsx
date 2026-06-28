import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2, DoorOpen, Loader2, ChevronRight, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/explorer")({
  head: () => ({ meta: [{ title: "Society Explorer — SocioHub" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s.block === "string" ? s.block : undefined,
    flat: typeof s.flat === "string" ? s.flat : undefined,
  }),
  component: ExplorerPage,
});

type Block = { id: string; name: string };
type Flat = { id: string; flat_number: string; block_id: string };
type BillRow = { id: string; flat_id: string; period_label: string; period_start: string; amount: number; status: string; due_date: string };
type PayRow = { id: string; bill_id: string; amount: number; paid_at: string; method: string };

function statusFor(amount: number, paid: number, today: Date, due: Date): "clear" | "pending" | "overdue" {
  if (amount <= paid + 0.001) return "clear";
  if (due < today) return "overdue";
  return "pending";
}

const DOT: Record<string, string> = {
  clear: "bg-emerald-500",
  pending: "bg-amber-500",
  overdue: "bg-destructive",
};

function ExplorerPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [resByFlat, setResByFlat] = useState<Record<string, { name: string; phone: string | null; email: string | null }[]>>({});

  useEffect(() => {
    if (!societyId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [b, f, bi, fr] = await Promise.all([
        supabase.from("blocks").select("id,name").eq("society_id", societyId).order("name"),
        supabase.from("flats").select("id,flat_number,block_id"),
        supabase.from("bills").select("id,flat_id,period_label,period_start,amount,status,due_date"),
        supabase.from("flat_residents").select("flat_id,user_id,relationship,profiles!flat_residents_user_id_fkey(full_name,phone,email)"),
      ]);
      if (cancel) return;
      if (b.error || f.error || bi.error) toast.error(b.error?.message || f.error?.message || bi.error?.message || "Load failed");
      const billIds = (bi.data ?? []).map((x) => x.id);
      const p = billIds.length
        ? await supabase.from("payments").select("id,bill_id,amount,paid_at,method").in("bill_id", billIds).eq("status", "success")
        : { data: [], error: null as any };
      setBlocks(b.data ?? []);
      setFlats((f.data ?? []) as Flat[]);
      setBills(((bi.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setPays(((p.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      const map: typeof resByFlat = {};
      for (const r of (fr.data ?? []) as any[]) {
        const prof = r.profiles ?? {};
        (map[r.flat_id] ||= []).push({ name: prof.full_name ?? "—", phone: prof.phone, email: prof.email });
      }
      setResByFlat(map);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [societyId]);

  const paidByBill = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of pays) m[p.bill_id] = (m[p.bill_id] ?? 0) + p.amount;
    return m;
  }, [pays]);

  const flatSummary = useMemo(() => {
    const today = new Date();
    const sum: Record<string, { outstanding: number; status: "clear" | "pending" | "overdue" }> = {};
    for (const f of flats) sum[f.id] = { outstanding: 0, status: "clear" };
    for (const b of bills) {
      if (b.status === "cancelled") continue;
      const paid = paidByBill[b.id] ?? 0;
      const remain = Math.max(0, b.amount - paid);
      sum[b.flat_id].outstanding += remain;
      const st = statusFor(b.amount, paid, today, new Date(b.due_date));
      const cur = sum[b.flat_id].status;
      const rank = { clear: 0, pending: 1, overdue: 2 } as const;
      if (rank[st] > rank[cur]) sum[b.flat_id].status = st;
    }
    return sum;
  }, [flats, bills, paidByBill]);

  const blockKpi = useMemo(() => {
    const k: Record<string, { total: number; clear: number; pending: number; overdue: number; outstanding: number }> = {};
    for (const b of blocks) k[b.id] = { total: 0, clear: 0, pending: 0, overdue: 0, outstanding: 0 };
    for (const f of flats) {
      const s = flatSummary[f.id];
      if (!k[f.block_id]) continue;
      k[f.block_id].total++;
      k[f.block_id][s.status]++;
      k[f.block_id].outstanding += s.outstanding;
    }
    return k;
  }, [blocks, flats, flatSummary]);

  if (sidLoading || loading) {
    return <PageShell><div className="grid place-items-center h-60"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></PageShell>;
  }

  // FLAT DETAIL
  if (search.flat) {
    const flat = flats.find((x) => x.id === search.flat);
    if (!flat) return <PageShell><EmptyState icon={DoorOpen} title="Flat not found" /></PageShell>;
    const block = blocks.find((x) => x.id === flat.block_id);
    const flatBills = bills.filter((x) => x.flat_id === flat.id).sort((a, b) => a.period_start.localeCompare(b.period_start));
    const flatPays = pays.filter((x) => flatBills.some((fb) => fb.id === x.bill_id)).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
    const residents = resByFlat[flat.id] ?? [];
    const summary = flatSummary[flat.id];
    return (
      <PageShell>
        <PageHeader
          title={`${block?.name ?? ""} — ${flat.flat_number}`}
          description="Resident details, payment history & month grid"
          actions={<Button variant="ghost" onClick={() => navigate({ to: "/society/explorer", search: { block: flat.block_id } })}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>}
        />
        <Card className="rounded-2xl">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className={cn("h-2.5 w-2.5 rounded-full", DOT[summary.status])} />
              <p className="font-medium capitalize">{summary.status}</p>
              <div className="ml-auto text-sm">Outstanding: <span className="font-semibold">₹{summary.outstanding.toLocaleString("en-IN")}</span></div>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Residents</h3>
          {residents.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="p-4 text-sm text-muted-foreground">No residents linked yet. Use Residents → Assign.</CardContent></Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {residents.map((r, i) => (
                <Card key={i} className="rounded-2xl">
                  <CardContent className="p-4">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.phone ?? "—"} · {r.email ?? "—"}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Month grid</h3>
          <MonthGrid bills={flatBills} paidByBill={paidByBill} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Bills</h3>
          <Card className="rounded-2xl"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="text-left p-3">Period</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Paid</th><th className="text-left p-3">Status</th></tr></thead>
              <tbody>
                {flatBills.map((b) => {
                  const paid = paidByBill[b.id] ?? 0;
                  return (
                    <tr key={b.id} className="border-t">
                      <td className="p-3">{b.period_label}</td>
                      <td className="p-3 text-right">₹{b.amount.toLocaleString("en-IN")}</td>
                      <td className="p-3 text-right">₹{paid.toLocaleString("en-IN")}</td>
                      <td className="p-3"><Badge variant="outline" className="capitalize">{b.status}</Badge></td>
                    </tr>
                  );
                })}
                {flatBills.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={4}>No bills yet.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent payments</h3>
          <Card className="rounded-2xl"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Method</th><th className="text-right p-3">Amount</th></tr></thead>
              <tbody>
                {flatPays.map((p) => (
                  <tr key={p.id} className="border-t"><td className="p-3">{new Date(p.paid_at).toLocaleDateString()}</td><td className="p-3 capitalize">{p.method}</td><td className="p-3 text-right">₹{p.amount.toLocaleString("en-IN")}</td></tr>
                ))}
                {flatPays.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={3}>No payments yet.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </section>
      </PageShell>
    );
  }

  // BLOCK DETAIL
  if (search.block) {
    const block = blocks.find((x) => x.id === search.block);
    if (!block) return <PageShell><EmptyState icon={Building2} title="Block not found" /></PageShell>;
    const items = flats.filter((f) => f.block_id === block.id).sort((a, b) => a.flat_number.localeCompare(b.flat_number, undefined, { numeric: true }));
    const k = blockKpi[block.id];
    return (
      <PageShell>
        <PageHeader
          title={block.name}
          description={`${k.total} units · ${k.clear} clear · ${k.pending} pending · ${k.overdue} overdue`}
          actions={<Button variant="ghost" onClick={() => navigate({ to: "/society/explorer", search: {} })}><ArrowLeft className="h-4 w-4 mr-1" /> Blocks</Button>}
        />
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
          {items.map((f) => {
            const s = flatSummary[f.id];
            return (
              <Link key={f.id} to="/society/explorer" search={{ flat: f.id }}>
                <Card className="rounded-2xl active:scale-[0.97] transition-transform">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", DOT[s.status])} />
                      <p className="font-semibold truncate">{f.flat_number}</p>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground truncate">
                      {s.outstanding > 0 ? `₹${s.outstanding.toLocaleString("en-IN")}` : "Clear"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
        {items.length === 0 && <EmptyState icon={DoorOpen} title="No units in this block" />}
      </PageShell>
    );
  }

  // BLOCKS HOME
  const totals = Object.values(blockKpi).reduce((a, k) => ({ total: a.total + k.total, clear: a.clear + k.clear, pending: a.pending + k.pending, overdue: a.overdue + k.overdue, outstanding: a.outstanding + k.outstanding }), { total: 0, clear: 0, pending: 0, overdue: 0, outstanding: 0 });

  return (
    <PageShell>
      <PageHeader title="Society Explorer" description="Browse blocks, units, and account status at a glance" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total units" value={String(totals.total)} />
        <KpiCard label="Clear" value={String(totals.clear)} tone="emerald" />
        <KpiCard label="Pending" value={String(totals.pending)} tone="amber" />
        <KpiCard label="Outstanding" value={`₹${totals.outstanding.toLocaleString("en-IN")}`} tone="rose" />
      </div>
      {blocks.length === 0 ? (
        <EmptyState icon={Building2} title="No blocks yet" description="Create blocks under Setup → Blocks to begin." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {blocks.map((b) => {
            const k = blockKpi[b.id];
            return (
              <Link key={b.id} to="/society/explorer" search={{ block: b.id }}>
                <Card className="rounded-2xl active:scale-[0.97] transition-transform">
                  <CardContent className="p-4">
                    <Building2 className="h-5 w-5 text-primary mb-2" />
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{k.total} units</p>
                    <div className="mt-2 flex items-center gap-2 text-[10px]">
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{k.clear}</span>
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{k.pending}</span>
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-destructive" />{k.overdue}</span>
                      <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" | "rose" }) {
  const c = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <Card className="rounded-2xl"><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", c)}>{value}</p>
    </CardContent></Card>
  );
}

function MonthGrid({ bills, paidByBill }: { bills: BillRow[]; paidByBill: Record<string, number> }) {
  const today = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), i, 1);
    return { idx: i, label: d.toLocaleString(undefined, { month: "short" }) };
  });
  const cellFor = (mi: number) => {
    const b = bills.find((x) => new Date(x.period_start).getMonth() === mi && new Date(x.period_start).getFullYear() === today.getFullYear());
    if (!b) return mi > today.getMonth() ? { label: "Not due", cls: "bg-secondary text-muted-foreground" } : { label: "—", cls: "bg-secondary text-muted-foreground" };
    const paid = paidByBill[b.id] ?? 0;
    if (paid >= b.amount) return { label: "Paid", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
    if (new Date(b.due_date) < today) return { label: "Overdue", cls: "bg-destructive/15 text-destructive" };
    return { label: "Pending", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  };
  return (
    <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
      {months.map((m) => {
        const c = cellFor(m.idx);
        return (
          <div key={m.idx} className={cn("rounded-xl text-center py-2 text-xs font-medium", c.cls)}>
            <div className="font-semibold">{m.label}</div>
            <div className="text-[10px] opacity-80">{c.label}</div>
          </div>
        );
      })}
    </div>
  );
}
