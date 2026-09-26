import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Users, Building2, Crown, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { MetricGroup } from "@/components/shared/MetricGroup";
import { ErrorState } from "@/components/system/ErrorState";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/security")({
  head: () => ({ meta: [{ title: "Security — Super Admin" }] }),
  component: SecurityPage,
});

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  society_admin: "Society admin",
  block_admin: "Block admin",
  resident: "Resident",
};
const ROLE_TONE: Record<string, "danger" | "primary" | "info" | "neutral"> = {
  super_admin: "danger",
  society_admin: "primary",
  block_admin: "info",
};

function SecurityPage() {
  const [filter, setFilter] = useState<string>("all");
  const { data: roles = [], isLoading, error, refetch } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, society_id, block_id, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const grouped = useMemo(() => roles.reduce<Record<string, number>>((acc, r: any) => {
    acc[r.role] = (acc[r.role] || 0) + 1;
    return acc;
  }, {}), [roles]);
  const shown = filter === "all" ? roles : roles.filter((r: any) => r.role === filter);
  const filters = ["all", ...Object.keys(grouped)];

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <PageHeader title="Security center" description="Who holds which role, with privileged roles first in mind." />

      <MetricGroup
        title="Role assignments"
        description="Latest 300"
        items={[
          { label: "Super admins", value: grouped["super_admin"] ?? 0, icon: Crown },
          { label: "Society admins", value: grouped["society_admin"] ?? 0, icon: Building2 },
          { label: "Block admins", value: grouped["block_admin"] ?? 0, icon: Building2 },
          { label: "Residents", value: grouped["resident"] ?? 0, icon: Users },
        ]}
      />

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" /> Protections in place
          <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="space-y-1 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <li>Row-level security on every public table.</li>
          <li>Role checks go through one server-side function.</li>
          <li>Subscription, payment and billing writes are validated on the server.</li>
          <li>Every society's data is isolated from every other society.</li>
          <li>Identity document uploads use dedicated guarded steps.</li>
        </ul>
      </details>

      <section className="space-y-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter by role">
          {filters.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
              )}
            >
              {f === "all" ? `All · ${roles.length}` : `${ROLE_LABEL[f] ?? f} · ${grouped[f]}`}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState title="Couldn't load roles" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No role assignments" />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {shown.map((r: any) => (
              <li key={`${r.user_id}-${r.role}-${r.society_id ?? ""}-${r.block_id ?? ""}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">User {r.user_id.slice(0, 8)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.society_id ? `Society ${r.society_id.slice(0, 8)}` : "Platform-wide"}
                    {r.block_id ? ` · Block ${r.block_id.slice(0, 8)}` : ""}
                    {" · since "}{new Date(r.created_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <StatusChip tone={ROLE_TONE[r.role] ?? "neutral"}>{ROLE_LABEL[r.role] ?? r.role}</StatusChip>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
