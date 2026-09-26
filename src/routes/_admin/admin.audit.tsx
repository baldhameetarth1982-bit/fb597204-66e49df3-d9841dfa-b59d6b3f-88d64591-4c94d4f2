import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/system/ErrorState";

export const Route = createFileRoute("/_admin/admin/audit")({
  head: () => ({ meta: [{ title: "Audit — Super Admin" }] }),
  component: AuditPage,
});

const human = (a: string) => a.replace(/[_.]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function AuditPage() {
  const [q, setQ] = useState("");
  const { data: rows = [], isLoading, error, refetch } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, actor_id, action, target_table, target_id, society_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = !s ? rows : rows.filter((r: any) =>
      r.action?.toLowerCase().includes(s) ||
      r.target_table?.toLowerCase().includes(s) ||
      r.target_id?.toLowerCase().includes(s) ||
      JSON.stringify(r.metadata ?? {}).toLowerCase().includes(s));
    const map = new Map<string, any[]>();
    for (const r of list as any[]) {
      const day = new Date(r.created_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return [...map.entries()];
  }, [rows, q]);
  const count = groups.reduce((a, [, l]) => a + l.length, 0);

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <PageHeader title="Audit center" description="Every recorded platform action, newest first. Latest 500 events." />

      <div className="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:px-0 md:py-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search action, table, id or details" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" aria-label="Search audit log" />
        </div>
        {q && <p className="mt-1.5 text-xs text-muted-foreground">{count} matching events</p>}
      </div>

      {error ? (
        <ErrorState title="Couldn't load the audit log" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" description={q ? "Try a different search." : undefined} />
      ) : (
        <div className="space-y-5">
          {groups.map(([day, list]) => (
            <section key={day} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</h2>
              <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {list.map((r: any) => (
                  <li key={r.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-3">
                    <time className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{human(r.action ?? "action")}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.target_table ?? "—"}{r.target_id ? ` · ${String(r.target_id).slice(0, 8)}` : ""}
                        {" · by "}<span className="font-mono">{r.actor_id?.slice(0, 8) ?? "system"}</span>
                        {r.society_id ? <> · society <span className="font-mono">{r.society_id.slice(0, 8)}</span></> : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
