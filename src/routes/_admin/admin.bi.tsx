import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Users, Building2, Wallet, Receipt, Activity, Heart, FileText, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_admin/admin/bi")({
  head: () => ({
    meta: [
      { title: "Business intelligence — SociyoHub Super Admin" },
      { name: "description", content: "Platform analytics for SociyoHub subscriptions, societies and payments." },
    ],
  }),
  component: BIHub,
});

type Item = { to: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Performance",
    items: [
      { to: "/admin/executive", icon: TrendingUp, title: "Executive overview", desc: "Collection, revenue, growth and health" },
      { to: "/admin/revenue", icon: Wallet, title: "Revenue", desc: "MRR, ARR and subscription income" },
      { to: "/admin/health", icon: Heart, title: "Society health", desc: "Ranked score per society" },
    ],
  },
  {
    title: "Records",
    items: [
      { to: "/admin/societies", icon: Building2, title: "Subscriptions", desc: "Active plans, trials and expiries" },
      { to: "/admin/users", icon: Users, title: "People", desc: "Users, roles and sign-ups" },
      { to: "/admin/income", icon: Receipt, title: "Payment ledger", desc: "Confirmed subscription payments" },
      { to: "/admin/audit", icon: Activity, title: "Platform activity", desc: "Every recorded platform action" },
    ],
  },
  {
    title: "Build your own",
    items: [{ to: "/admin/report-builder", icon: FileText, title: "Report builder", desc: "Compose reports and export CSV" }],
  },
];

function BIHub() {
  const q = useQuery({
    queryKey: ["admin-platform-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_platform_summary");
      if (error) throw new Error("load_failed");
      return data?.[0] ?? null;
    },
  });
  const n = (v: unknown) => Number(v ?? 0);
  const s = q.data;
  const metrics = [
    { k: "Societies", v: s ? n(s.total_societies).toLocaleString("en-IN") : "—" },
    { k: "Active", v: s ? n(s.active_societies).toLocaleString("en-IN") : "—" },
    { k: "On trial", v: s ? n(s.trialing_societies).toLocaleString("en-IN") : "—" },
    { k: "Users", v: s ? n(s.total_users).toLocaleString("en-IN") : "—" },
  ];

  return (
    <PageShell>
      <PageHeader title="Business intelligence" description="Pick a question to answer. Key figures are shown first." />

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.k} className="border-b border-r border-border px-4 py-3.5 md:px-5 lg:border-b-0">
            <dt className="text-xs text-muted-foreground">{m.k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums md:text-2xl">
              {q.isLoading ? <Skeleton className="h-7 w-16" /> : m.v}
            </dd>
          </div>
        ))}
      </dl>
      {q.isError && (
        <div role="alert" className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm">Platform figures couldn't load.</p>
          <button type="button" onClick={() => q.refetch()} className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-medium">Try again</button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {GROUPS.map((g) => (
          <section key={g.title} className="min-w-0">
            <h2 className="mb-2 text-sm font-semibold">{g.title}</h2>
            <ul className="divide-y overflow-hidden rounded-xl border border-border bg-card">
              {g.items.map((i) => (
                <li key={i.to}>
                  <Link to={i.to as any} className="grid min-h-[60px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none">
                    <i.icon className="h-4 w-4 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{i.desc}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
