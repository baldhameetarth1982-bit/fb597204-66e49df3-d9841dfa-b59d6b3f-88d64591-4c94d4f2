import { Skeleton } from "@/components/ui/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Users, TrendingUp, CreditCard, Wallet, ShieldCheck,
  Megaphone, Tags, ScrollText, Settings, ArrowRight, BarChart3,
  Banknote, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { StatusChip } from "@/components/system/StatusChip";

export const Route = createFileRoute("/_admin/admin/dashboard")({
  head: () => ({ meta: [{ title: "Super Admin — SociyoHub" }] }),
  component: AdminDashboard,
});

function fmt(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function compact(n: number) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return fmt(n);
}

type ModuleItem = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
};

const GROWTH: ModuleItem[] = [
  { to: "/admin/societies", icon: Building2, title: "Societies", desc: "Activate, suspend, grant plans." },
  { to: "/admin/users", icon: Users, title: "Users", desc: "Every user across the platform." },
  { to: "/admin/plans", icon: Tags, title: "Plans", desc: "Basic, Pro, Premium tiers." },
  { to: "/admin/custom-plans", icon: Sparkles, title: "Custom plans", desc: "Bespoke pricing." },
];
const MONEY: ModuleItem[] = [
  { to: "/admin/revenue", icon: TrendingUp, title: "Revenue", desc: "MRR, ARR, subscription income." },
  { to: "/admin/income", icon: BarChart3, title: "Income ledger", desc: "Detailed payment log." },
  { to: "/admin/razorpay", icon: CreditCard, title: "Payment gateway", desc: "Razorpay keys & status." },
  { to: "/admin/withdrawals", icon: Banknote, title: "Withdrawals", desc: "Referral payouts." },
];
const PLATFORM: ModuleItem[] = [
  { to: "/admin/ads", icon: Megaphone, title: "Ads", desc: "Banner & interstitial." },
  { to: "/admin/audit", icon: ScrollText, title: "Audit log", desc: "Every platform action." },
  { to: "/admin/security", icon: ShieldCheck, title: "Security", desc: "Roles & posture." },
  { to: "/admin/settings", icon: Settings, title: "Settings", desc: "Global toggles." },
];

function AdminDashboard() {
  const sumQ = useQuery({
    queryKey: ["admin-platform-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_platform_summary");
      if (error) throw new Error("load_failed");
      return data?.[0] ?? null;
    },
  });

  const revQ = useQuery({
    queryKey: ["admin-mrr"],
    queryFn: async () => {
      const [socs, plans] = await Promise.all([
        supabase.from("societies").select("plan_id, plan_expires_at, status").eq("plan_status", "active"),
        supabase.from("plans").select("id, price_monthly_inr"),
      ]);
      // Never compute revenue from a partial dataset.
      if (socs.error || plans.error) throw new Error("load_failed");
      const map = new Map<string, number>(
        (plans.data ?? []).map((p: any) => [p.id, Number(p.price_monthly_inr ?? 0)]),
      );
      const now = Date.now();
      let mrr = 0;
      for (const s of socs.data ?? []) {
        if ((s as any).status === "suspended") continue;
        const exp = (s as any).plan_expires_at as string | null;
        if (exp && new Date(exp).getTime() < now) continue; // expired plans aren't recurring revenue
        mrr += map.get(s.plan_id ?? "") ?? 0; // unknown plan ids contribute nothing
      }
      return { mrr };
    },
  });

  const summary = sumQ.data;
  const sumOk = sumQ.isSuccess && !!summary;
  const dash = "—";
  const num = (v: unknown) => Number(v ?? 0);
  const activeSocs = num(summary?.active_societies);
  const trialing = num(summary?.trialing_societies);
  const unpaid = num(summary?.unpaid_bill_total);

  const metrics = [
    { k: "Monthly recurring revenue", v: revQ.isSuccess ? compact(revQ.data.mrr) : dash, loading: revQ.isLoading },
    { k: "Societies", v: sumOk ? String(num(summary.total_societies)) : dash, loading: sumQ.isLoading },
    { k: "Users", v: sumOk ? num(summary.total_users).toLocaleString("en-IN") : dash, loading: sumQ.isLoading },
    { k: "Confirmed payments", v: sumOk ? compact(num(summary.successful_payment_total)) : dash, loading: sumQ.isLoading },
  ];

  return (
    <div className="container-page py-5 md:py-8">
      <header className="border-b border-border pb-5">
        <p className="text-sm text-muted-foreground">Super Admin</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Platform overview</h1>
      </header>

      <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>div]:border-border [&>div:nth-child(odd)]:border-r lg:[&>div]:border-r lg:[&>div:last-child]:border-r-0 [&>div:nth-child(-n+2)]:border-b lg:[&>div]:border-b-0">
        {metrics.map((m) => (
          <div key={m.k} className="px-4 py-3.5 md:px-5 md:py-4">
            <dt className="text-xs text-muted-foreground">{m.k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight md:text-2xl">
              {m.loading ? <Skeleton className="h-7 w-20" /> : m.v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-7">
          {(sumQ.isError || revQ.isError) && (
            <div role="alert" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-foreground">Some platform figures couldn't load. Numbers show "—" until they do.</p>
              <button
                type="button"
                onClick={() => { sumQ.refetch(); revQ.refetch(); }}
                className="min-h-11 shrink-0 rounded-lg border border-border bg-card px-4 text-sm font-medium"
              >
                Try again
              </button>
            </div>
          )}
          <section aria-labelledby="pulse-h">
            <h2 id="pulse-h" className="mb-2 text-sm font-semibold">Needs your attention</h2>
            <ul className="divide-y overflow-hidden rounded-xl border border-border bg-card">
              <li className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Active subscriptions</p>
                  <p className="truncate text-xs text-muted-foreground">{sumOk ? `${activeSocs} paying · ${trialing} on trial` : sumQ.isLoading ? "Loading…" : "Unavailable"}</p>
                </div>
                <StatusChip tone={sumOk ? "success" : "neutral"}>{sumOk ? `${activeSocs} active` : dash}</StatusChip>
              </li>
              <li className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Outstanding bills</p>
                  <p className="truncate text-xs text-muted-foreground">Across all societies, all months</p>
                </div>
                <StatusChip tone={!sumOk ? "neutral" : unpaid > 0 ? "warning" : "success"}>{sumOk ? compact(unpaid) : dash}</StatusChip>
              </li>
              <li>
                <Link to={"/admin/razorpay" as any} className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Payment gateway</p>
                    <p className="truncate text-xs text-muted-foreground">Razorpay handles SociyoHub plan payments</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">Check status <ArrowRight className="h-4 w-4" aria-hidden /></span>
                </Link>
              </li>
            </ul>
          </section>
          <ModuleGroup title="Growth" items={GROWTH} />
        </div>
        <aside className="min-w-0 space-y-6 lg:col-span-5">
          <ModuleGroup title="Money" items={MONEY} />
          <ModuleGroup title="Platform" items={PLATFORM} />
        </aside>
      </div>
    </div>
  );
}

function ModuleGroup({ title, items }: { title: string; items: ModuleItem[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <ul className="divide-y overflow-hidden rounded-xl border border-border bg-card">
        {items.map((m) => (
          <li key={m.to}>
            <Link to={m.to as any} className="grid min-h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60">
              <m.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{m.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{m.desc}</span>
              </span>
              <ChevronRightIcon />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChevronRightIcon() {
  return <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />;
}
