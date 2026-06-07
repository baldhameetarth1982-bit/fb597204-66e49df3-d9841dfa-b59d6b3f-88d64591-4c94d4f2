import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building2,
  Wallet,
  AlertTriangle,
  Megaphone,
  ArrowUpRight,
  KeyRound,
  Copy,
  Inbox,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SocioHub" },
      { name: "description", content: "Society admin overview." },
    ],
  }),
  component: SocietyDashboard,
});

interface DashboardStats {
  totalFlats: number;
  totalBlocks: number;
  collectedThisMonth: number;
  defaulters: number;
}

interface AnnouncementItem {
  id: string;
  excerpt: string;
  created_at: string;
}

interface TxnItem {
  id: string;
  amount: number;
  status: string;
  paid_at: string | null;
  flat_label: string;
  resident_name: string | null;
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "paid" || s === "success"
      ? "bg-success/10 text-success"
      : s === "failed"
      ? "bg-destructive/10 text-destructive"
      : "bg-warning/10 text-warning";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function SocietyDashboard() {
  const { societyId } = useSocietyId();
  const [society, setSociety] = useState<{ name: string; invite_code: string | null } | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalFlats: 0,
    totalBlocks: 0,
    collectedThisMonth: 0,
    defaulters: 0,
  });
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [txns, setTxns] = useState<TxnItem[]>([]);

  useEffect(() => {
    if (!societyId) return;
    let cancelled = false;

    (async () => {
      const [{ data: soc }, { count: flatCount }, { count: blockCount }, posts, payments] = await Promise.all([
        supabase.from("societies").select("name, invite_code").eq("id", societyId).maybeSingle(),
        supabase.from("flats").select("id", { count: "exact", head: true }).eq("society_id", societyId),
        supabase.from("blocks").select("id", { count: "exact", head: true }).eq("society_id", societyId),
        supabase
          .from("posts")
          .select("id, body, created_at")
          .eq("society_id", societyId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("payments")
          .select("id, amount, status, paid_at")
          .eq("society_id", societyId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (cancelled) return;

      setSociety((soc as any) ?? null);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const paidThisMonth = (payments.data ?? []).filter(
        (p: any) => p.status === "success" && p.paid_at && new Date(p.paid_at) >= monthStart,
      );
      const collected = paidThisMonth.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);

      const { count: overdueCount } = await supabase
        .from("bills")
        .select("id", { count: "exact", head: true })
        .eq("society_id", societyId)
        .in("status", ["overdue", "unpaid"]);

      setStats({
        totalFlats: flatCount ?? 0,
        totalBlocks: blockCount ?? 0,
        collectedThisMonth: collected,
        defaulters: overdueCount ?? 0,
      });

      setAnnouncements(
        (posts.data ?? []).map((p: any) => {
          const s = String(p.body ?? "").replace(/\s+/g, " ").trim();
          return {
            id: p.id,
            excerpt: s.length > 80 ? `${s.slice(0, 80)}…` : s || "Untitled",
            created_at: p.created_at,
          };
        }),
      );

      setTxns(
        (payments.data ?? []).slice(0, 6).map((p: any) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          status: p.status ?? "pending",
          paid_at: p.paid_at,
          flat_label: "—",
          resident_name: null,
        })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [societyId]);

  function copyCode() {
    if (!society?.invite_code) return;
    navigator.clipboard.writeText(society.invite_code);
    toast.success("Invite code copied");
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">A snapshot of your society today.</p>
      </header>

      {society?.invite_code && (
        <Card className="rounded-2xl mb-6 border-primary/20 bg-primary/5">
          <CardContent className="p-5 flex flex-wrap items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 grid place-items-center">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Invite code for residents</p>
              <p className="text-2xl font-bold tracking-[0.3em] font-mono mt-0.5">{society.invite_code}</p>
            </div>
            <Button onClick={copyCode} variant="outline" className="rounded-xl">
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total registered flats</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">{stats.totalFlats}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.totalBlocks > 0 ? `Across ${stats.totalBlocks} block${stats.totalBlocks === 1 ? "" : "s"}` : "Add blocks to begin"}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected this month</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Wallet className="h-5 w-5 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">{INR.format(stats.collectedThisMonth)}</p>
            <p className="mt-1 text-xs text-muted-foreground">From successful payments</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Defaulters</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-destructive/10 grid place-items-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">{stats.defaulters}</p>
            <p className="mt-1 text-xs text-muted-foreground">Unpaid or overdue bills</p>
          </CardContent>
        </Card>
      </section>

      {stats.totalBlocks === 0 && (
        <Card className="rounded-2xl mb-6 border-dashed">
          <CardContent className="p-6 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium">Your society is ready to be set up</p>
            <p className="text-sm text-muted-foreground mt-1">Start by adding blocks, floors, and flats.</p>
            <Button asChild className="mt-4 rounded-xl">
              <Link to="/society/blocks">Add your first block</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" /> Recent announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Inbox className="h-6 w-6 mx-auto mb-2 opacity-60" />
                No announcements yet
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {announcements.map((a) => (
                  <li key={a.id} className="py-4 first:pt-0 last:pb-0">
                    <p className="font-medium line-clamp-2">{a.excerpt}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent transactions</CardTitle>
            <Link
              to="/society/ledger"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {txns.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Wallet className="h-6 w-6 mx-auto mb-2 opacity-60" />
                No transactions yet
              </div>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-2 font-medium">Amount</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {txns.map((t) => (
                      <tr key={t.id}>
                        <td className="px-2 py-3 tabular-nums">{INR.format(t.amount)}</td>
                        <td className="px-2 py-3"><StatusPill status={t.status} /></td>
                        <td className="px-2 py-3 text-muted-foreground">
                          {t.paid_at ? new Date(t.paid_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
