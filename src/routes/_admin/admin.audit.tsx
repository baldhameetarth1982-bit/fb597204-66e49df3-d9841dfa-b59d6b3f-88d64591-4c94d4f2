import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/audit")({
  head: () => ({ meta: [{ title: "Audit — Super Admin" }] }),
  component: AuditPage,
});

function AuditPage() {
  const [q, setQ] = useState("");
  const { data: rows = [], isLoading } = useQuery({
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

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r: any) =>
      r.action?.toLowerCase().includes(s) ||
      r.target_table?.toLowerCase().includes(s) ||
      r.target_id?.toLowerCase().includes(s) ||
      JSON.stringify(r.metadata ?? {}).toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <ScrollText className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Audit Center</h1>
          <p className="text-sm text-muted-foreground">Every platform action is recorded. Latest 500 events.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search action, table, id, metadata…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Society</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.target_table ?? "—"}</div>
                      <div className="text-muted-foreground">{r.target_id ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.actor_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{r.society_id?.slice(0, 8) ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No audit entries</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
