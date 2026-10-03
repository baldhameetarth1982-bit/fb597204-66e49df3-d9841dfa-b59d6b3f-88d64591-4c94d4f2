import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListEmpty, ListSkeleton, LoadError } from "@/components/people/PeopleUI";

type Row = { ad_id: string; title: string; kind: string; placement: string; views: number; clicks: number; cta: number; target_cities: string[] | null; target_plans: string[] | null; target_society_count: number; active: boolean };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Super Admin only (enforced by get_ad_report). Aggregated counts — no viewer identities are stored. */
export function AdReport() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const q = useQuery({
    queryKey: ["ad-report", from, to],
    placeholderData: (p) => p,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_ad_report", { _from: from, _to: to });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const rows = q.data ?? [];
  const tv = rows.reduce((a, r) => a + Number(r.views), 0);
  const tc = rows.reduce((a, r) => a + Number(r.clicks), 0);
  const ctr = (v: number, c: number) => (v >= 20 ? `${((c / v) * 100).toFixed(1)}%` : "—");
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="ad-rep">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="ad-rep" className="font-semibold">Sponsored performance</h2>
          <p className="text-xs text-muted-foreground">Unique views and clicks per person every 30 minutes. Plain service listings aren't counted. CTR shows from 20 views.</p>
        </div>
        <div className="flex gap-2">
          <div className="space-y-1"><Label htmlFor="rf" className="text-xs">From</Label><Input id="rf" type="date" className="min-h-11" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="rt" className="text-xs">To</Label><Input id="rt" type="date" className="min-h-11" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>
      {q.isLoading ? <ListSkeleton rows={3} /> : q.isError ? <LoadError title="Couldn't load the report" onRetry={() => void q.refetch()} /> : !rows.length ? (
        <ListEmpty icon={BarChart3} title="No sponsored activity in this range">Views appear once residents see banners or sponsored cards.</ListEmpty>
      ) : (
        <>
          <p className="text-sm tabular-nums">{tv.toLocaleString("en-IN")} views · {tc.toLocaleString("en-IN")} clicks · CTR {ctr(tv, tc)}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Campaign</th><th className="pr-3">Placement</th><th className="pr-3 text-right">Views</th><th className="pr-3 text-right">Clicks</th><th className="pr-3 text-right">Contact taps</th><th className="pr-3 text-right">CTR</th><th>Targeting</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.ad_id + r.placement}>
                    <td className="py-2 pr-3"><span className="font-medium">{r.title}</span><span className="block text-xs text-muted-foreground capitalize">{r.kind}{r.active ? "" : " · inactive"}</span></td>
                    <td className="pr-3 text-xs">{r.placement}</td>
                    <td className="pr-3 text-right tabular-nums">{Number(r.views).toLocaleString("en-IN")}</td>
                    <td className="pr-3 text-right tabular-nums">{Number(r.clicks).toLocaleString("en-IN")}</td>
                    <td className="pr-3 text-right tabular-nums">{Number(r.cta).toLocaleString("en-IN")}</td>
                    <td className="pr-3 text-right tabular-nums">{ctr(Number(r.views), Number(r.clicks))}</td>
                    <td className="text-xs text-muted-foreground">{[r.target_cities?.length ? r.target_cities.join(", ") : "All cities", r.target_plans?.length ? r.target_plans.join("/") : "All plans", r.target_society_count ? `${r.target_society_count} societies` : null].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
