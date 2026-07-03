import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/health")({
  head: () => ({ meta: [{ title: "Society Health — Super Admin" }] }),
  component: HealthPage,
});

type Row = {
  id: string; name: string; score: number; label: string;
  paid: number; unpaid: number; residents: number; complaints: number; planActive: boolean;
};

function scoreFor(paid: number, unpaid: number, residents: number, complaints: number, planActive: boolean): number {
  let s = 0;
  const total = paid + unpaid;
  const collection = total > 0 ? paid / total : 0;
  s += collection >= 0.8 ? 30 : collection >= 0.5 ? 20 : collection >= 0.2 ? 10 : 0;
  s += residents >= 30 ? 25 : residents >= 10 ? 15 : residents > 0 ? 8 : 0;
  s += complaints <= 5 ? 20 : complaints <= 20 ? 10 : 0;
  s += planActive ? 25 : 5;
  return Math.min(100, s);
}
function labelFor(n: number) {
  if (n >= 85) return "Excellent";
  if (n >= 70) return "Good";
  if (n >= 50) return "Needs attention";
  return "Critical";
}

function HealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const [socs, bills, resAgg, posts] = await Promise.all([
        supabase.rpc("admin_list_societies"),
        supabase.from("bills").select("society_id, amount, status"),
        supabase.from("flat_residents").select("flat_id, flats!inner(society_id)"),
        supabase.from("posts").select("society_id"),
      ]);
      const paidBy = new Map<string, number>();
      const unpaidBy = new Map<string, number>();
      for (const b of bills.data ?? []) {
        if (!b.society_id) continue;
        if (b.status === "paid") paidBy.set(b.society_id, (paidBy.get(b.society_id) ?? 0) + Number(b.amount ?? 0));
        else if (b.status === "unpaid" || b.status === "overdue") unpaidBy.set(b.society_id, (unpaidBy.get(b.society_id) ?? 0) + Number(b.amount ?? 0));
      }
      const residentsBy = new Map<string, number>();
      for (const r of (resAgg.data ?? []) as any[]) {
        const sid = r.flats?.society_id;
        if (sid) residentsBy.set(sid, (residentsBy.get(sid) ?? 0) + 1);
      }
      const postsBy = new Map<string, number>();
      for (const p of (posts.data ?? []) as any[]) {
        if (p.society_id) postsBy.set(p.society_id, (postsBy.get(p.society_id) ?? 0) + 1);
      }
      return (socs.data ?? []).map((s: any): Row => {
        const paid = paidBy.get(s.id) ?? 0;
        const unpaid = unpaidBy.get(s.id) ?? 0;
        const residents = residentsBy.get(s.id) ?? 0;
        const complaints = postsBy.get(s.id) ?? 0;
        const planActive = s.plan_status === "active";
        const score = scoreFor(paid, unpaid, residents, complaints, planActive);
        return { id: s.id, name: s.name, score, label: labelFor(score), paid, unpaid, residents, complaints, planActive };
      });
    },
  });

  const rows = useMemo(() => (data ?? []).slice().sort((a, b) => b.score - a.score), [data]);

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <Heart className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Society Health Score</h1>
          <p className="text-sm text-muted-foreground">Composite ranking of financial, engagement and configuration signals.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Society</TableHead>
                  <TableHead className="w-40">Score</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="text-right">Collection</TableHead>
                  <TableHead className="text-right">Residents</TableHead>
                  <TableHead className="text-right">Complaints</TableHead>
                  <TableHead>Plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const total = r.paid + r.unpaid;
                  const pct = total > 0 ? Math.round((r.paid / total) * 100) : 0;
                  const tone =
                    r.score >= 85 ? "default" :
                    r.score >= 70 ? "secondary" :
                    r.score >= 50 ? "outline" : "destructive";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={r.score} className="h-2 w-24" />
                          <span className="text-sm font-semibold tabular-nums">{r.score}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={tone as any}>{r.label}</Badge></TableCell>
                      <TableCell className="text-right text-xs">{pct}%</TableCell>
                      <TableCell className="text-right text-xs">{r.residents}</TableCell>
                      <TableCell className="text-right text-xs">{r.complaints}</TableCell>
                      <TableCell><Badge variant={r.planActive ? "default" : "outline"}>{r.planActive ? "active" : "—"}</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No societies yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
