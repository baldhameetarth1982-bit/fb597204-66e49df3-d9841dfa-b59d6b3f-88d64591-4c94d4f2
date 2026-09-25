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

  return (
    <div className="min-h-dvh bg-muted/30 pb-24">
      <MobileHero
        eyebrow="Super Admin"
        title="Command Center"
        subtitle="Every society, every rupee, every user — one screen."
        icon={Sparkles}
        variant="navy"
        stats={
          <StatPillRow>
            <StatPill label="MRR" value={revQ.isSuccess ? compact(revQ.data.mrr) : dash} icon={TrendingUp} />
            <StatPill label="Societies" value={sumOk ? num(summary.total_societies) : dash} icon={Building2} />
            <StatPill label="Users" value={sumOk ? num(summary.total_users).toLocaleString("en-IN") : dash} icon={Users} />
            <StatPill label="Payments" value={sumOk ? compact(num(summary.successful_payment_total)) : dash} icon={CreditCard} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto">
        {(sumQ.isError || revQ.isError) && (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-foreground">Some platform figures couldn't load. Numbers show "—" until they do.</p>
            <button
              type="button"
              onClick={() => { sumQ.refetch(); revQ.refetch(); }}
              className="min-h-11 shrink-0 rounded-xl border border-border bg-card px-4 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        )}
        <SectionCard title="Platform pulse" icon={ShieldCheck} bodyClassName="p-0">
          <ListCardGroup>
            <ListCard
              title="Active subscriptions"
              subtitle={sumOk ? `${activeSocs} paying · ${trialing} on trial` : sumQ.isLoading ? "Loading…" : "Unavailable"}
              trailing={<StatusChip tone={sumOk ? "success" : "neutral"}>{sumOk ? `${activeSocs} active` : dash}</StatusChip>}
            />
            <ListCard
              title="Outstanding bills"
              subtitle="Across all societies, all months"
              trailing={
                <StatusChip tone={!sumOk ? "neutral" : unpaid > 0 ? "warning" : "success"}>{sumOk ? compact(unpaid) : dash}</StatusChip>
              }
            />
            <ListCard
              title="Payment gateway"
              subtitle="Razorpay handles SociyoHub plan payments"
              trailing={
                <Link to={"/admin/razorpay" as any} className="text-sm font-medium text-primary">Check status</Link>
              }
            />
          </ListCardGroup>
        </SectionCard>

        <ModuleGroup title="Growth" items={GROWTH} />
        <ModuleGroup title="Money" items={MONEY} />
        <ModuleGroup title="Platform" items={PLATFORM} />
      </div>
    </div>
  );
}

function ModuleGroup({ title, items }: { title: string; items: ModuleItem[] }) {
  return (
    <SectionCard title={title} bodyClassName="p-0">
      <ListCardGroup>
        {items.map((m) => (
          <Link key={m.to} to={m.to as any} className="block">
            <ListCard
              leading={
                <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary grid place-items-center">
                  <m.icon className="h-4 w-4" />
                </div>
              }
              title={m.title}
              subtitle={m.desc}
              trailing={<ArrowRight className="h-4 w-4 text-muted-foreground" />}
              className="hover:bg-primary/5"
            />
          </Link>
        ))}
      </ListCardGroup>
    </SectionCard>
  );
}
