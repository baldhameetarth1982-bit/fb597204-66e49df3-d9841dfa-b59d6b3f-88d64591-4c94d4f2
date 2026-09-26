import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/system/StatusChip";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";

export const Route = createFileRoute("/_admin/admin/search")({
  head: () => ({ meta: [{ title: "Platform Search — Super Admin" }] }),
  component: AdminSearchPage,
});

function AdminSearchPage() {
  const [q, setQ] = useState("");
  const { data: societies = [], isFetching, isError, refetch } = useQuery({
    queryKey: ["admin-search-societies"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_societies");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return societies.filter((r: any) =>
      r.name?.toLowerCase().includes(s) || r.id?.includes(s) || r.plan_id?.toLowerCase().includes(s),
    ).slice(0, 50);
  }, [societies, q]);

  return (
    <PageShell>
      <PageHeader title="Platform Search" description="Find any society by name, ID or plan." />
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            aria-label="Search societies"
            placeholder={`Search ${societies.length ? societies.length.toLocaleString("en-IN") + " " : ""}societies…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-12 rounded-2xl pl-11 text-base"
          />
          {isFetching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {isError ? (
          <ErrorState onRetry={() => refetch()} showSupport={false} />
        ) : !q.trim() ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Start typing to search.</p>
        ) : filtered.length === 0 ? (
          !isFetching && <p className="py-10 text-center text-sm text-muted-foreground">No societies match "{q}".</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filtered.map((r: any) => (
              <li key={r.id}>
                <Link
                  to="/admin/societies/$id"
                  params={{ id: r.id }}
                  className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{r.id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
                    <StatusChip tone="neutral" className="capitalize">{r.plan_id ?? "—"}</StatusChip>
                    <StatusChip tone={r.status === "active" ? "success" : "warning"} className="capitalize">{r.status}</StatusChip>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
