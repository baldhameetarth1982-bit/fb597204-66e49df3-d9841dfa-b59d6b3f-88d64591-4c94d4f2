import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_admin/admin/search")({
  head: () => ({ meta: [{ title: "Platform Search — Super Admin" }] }),
  component: AdminSearchPage,
});

function AdminSearchPage() {
  const [q, setQ] = useState("");
  const { data: societies = [], isFetching } = useQuery({
    queryKey: ["admin-search-societies"],
    queryFn: async () => {
      const { data } = await supabase.rpc("admin_list_societies");
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
    <div className="container-page space-y-6 py-6 md:py-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between"><div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Platform Search</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Locate any society across the platform.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search societies by name, id or plan…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            {isFetching && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {filtered.map((r: any) => (
          <Card key={r.id} className="rounded-xl">
            <CardContent className="p-4 flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{r.id}</div>
              </div>
              <Badge variant="secondary">{r.plan_id ?? "—"}</Badge>
              <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge>
            </CardContent>
          </Card>
        ))}
        {q.trim() && filtered.length === 0 && !isFetching && (
          <p className="text-sm text-muted-foreground text-center py-8">No matches.</p>
        )}
      </div>
    </div>
  );
}
