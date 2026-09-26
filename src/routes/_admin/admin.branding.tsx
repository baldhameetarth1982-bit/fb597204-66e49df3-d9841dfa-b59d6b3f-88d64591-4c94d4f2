import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, X, Search, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { MetricGroup } from "@/components/shared/MetricGroup";
import { ErrorState } from "@/components/system/ErrorState";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/branding")({
  head: () => ({ meta: [{ title: "Branding — Super Admin" }] }),
  component: BrandingPage,
});

type Filter = "all" | "incomplete" | "complete";

function BrandingPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-branding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("societies")
        .select("id, name, logo_url, bill_theme, signature_url, plan_id, status")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = data ?? [];
  const stats = useMemo(() => ({
    total: rows.length,
    withLogo: rows.filter((r: any) => r.logo_url).length,
    withSignature: rows.filter((r: any) => r.signature_url).length,
    complete: rows.filter((r: any) => r.logo_url && r.signature_url).length,
  }), [rows]);

  const shown = rows.filter((r: any) => {
    const done = Boolean(r.logo_url && r.signature_url);
    if (filter === "complete" && !done) return false;
    if (filter === "incomplete" && done) return false;
    return !q || r.name?.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <PageHeader title="Branding" description="How ready each society's logo and signature are for bills and receipts." />

      <MetricGroup
        title="Branding readiness"
        items={[
          { label: "Societies", value: stats.total },
          { label: "Fully branded", value: stats.complete, hint: "Logo + signature" },
          { label: "With logo", value: stats.withLogo },
          { label: "With signature", value: stats.withSignature },
        ]}
      />

      <section className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search societies" className="h-11 pl-9" aria-label="Search societies" />
          </div>
          <div className="flex gap-1 rounded-xl bg-muted p-1" role="tablist">
            {(["all", "incomplete", "complete"] as Filter[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn("min-h-9 flex-1 rounded-lg px-3 text-sm capitalize", filter === f ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}
              >
                {f === "incomplete" ? "Missing items" : f}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <ErrorState title="Couldn't load societies" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Palette} title="No societies match" description="Try a different search or filter." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {shown.map((r: any) => (
              <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                {r.logo_url ? (
                  <img src={r.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted"><Building2 className="h-4 w-4 text-muted-foreground" /></div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.plan_id ?? "No plan"} · {r.bill_theme ?? "classic"} bill theme · {r.status}</p>
                </div>
                <div className="col-span-2 flex flex-wrap gap-1.5 md:col-span-1">
                  <Item ok={!!r.logo_url} label="Logo" />
                  <Item ok={!!r.signature_url} label="Signature" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Item({ ok, label }: { ok: boolean; label: string }) {
  return (
    <StatusChip tone={ok ? "success" : "neutral"} icon={ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}>
      {label}
    </StatusChip>
  );
}
