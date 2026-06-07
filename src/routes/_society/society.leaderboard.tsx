import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_society/society/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — SocioHub" }] }),
  component: Leaderboard,
});

interface Row { user_id: string; total: number; name: string | null }

function Leaderboard() {
  const { societyId, loading: sl } = useSocietyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId) { if (!sl) setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_points")
        .select("user_id, points")
        .eq("society_id", societyId);
      const totals = new Map<string, number>();
      (data ?? []).forEach((r: any) => totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + r.points));
      const ids = [...totals.keys()];
      let names = new Map<string, string | null>();
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        names = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      }
      setRows([...totals.entries()]
        .map(([user_id, total]) => ({ user_id, total, name: names.get(user_id) ?? null }))
        .sort((a, b) => b.total - a.total));
      setLoading(false);
    })();
  }, [societyId, sl]);

  if (sl || loading) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <PageShell>
      <PageHeader title="Leaderboard" description="Top residents by community points." />
      {rows.length === 0 ? (
        <EmptyState icon={Trophy} title="No points yet" description="Residents earn points by posting and paying bills on time." />
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <Card key={r.user_id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`h-10 w-10 rounded-xl grid place-items-center font-bold ${i === 0 ? "bg-warning/15 text-warning" : i < 3 ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {i + 1}
                </div>
                <p className="flex-1 font-medium truncate">{r.name ?? "Resident"}</p>
                <p className="text-sm font-semibold tabular-nums">{r.total} pts</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
