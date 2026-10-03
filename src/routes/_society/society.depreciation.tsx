import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { currentFy, depreciationSchedule, type DepMethod, type DepSettings } from "@/lib/depreciation";

export const Route = createFileRoute("/_society/society/depreciation")({
  head: () => ({
    meta: [
      { title: "Asset depreciation — SociyoHub" },
      { name: "description", content: "Straight-line and written-down-value depreciation schedules for society assets." },
      { property: "og:title", content: "Asset depreciation — SociyoHub" },
      { property: "og:description", content: "Book value and yearly depreciation for every society asset." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DepreciationPage,
});

type Asset = { asset_id: string; name: string; category: string; status: string; purchase_date: string | null };
type Row = DepSettings & { asset_id: string };
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DepreciationPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Asset | null>(null);
  const [view, setView] = useState<Asset | null>(null);
  const [f, setF] = useState({ cost: "", salvage: "0", method: "slm" as DepMethod, life: "10", rate: "15", start: "" });
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["depreciation", societyId],
    queryFn: async () => {
      const [a, s] = await Promise.all([
        supabase.rpc("list_depreciation_assets", { _society_id: societyId! }),
        supabase.from("asset_depreciation_settings").select("asset_id,cost,salvage,method,life_years,wdv_rate,start_date").eq("society_id", societyId!),
      ]);
      if (a.error) throw a.error; if (s.error) throw s.error;
      return { assets: (a.data ?? []) as Asset[], settings: new Map((s.data as Row[]).map((r) => [r.asset_id, { ...r, cost: Number(r.cost), salvage: Number(r.salvage), wdv_rate: r.wdv_rate == null ? null : Number(r.wdv_rate) }])) };
    },
  });

  const fy = currentFy();
  const summary = useMemo(() => {
    let cost = 0, book = 0, charge = 0;
    for (const s of q.data?.settings.values() ?? []) {
      const sch = depreciationSchedule(s);
      const cur = sch.find((y) => y.fy === fy);
      cost += s.cost;
      charge += cur?.charge ?? 0;
      const idx = sch.findIndex((y) => y.fy === fy);
      book += idx >= 0 ? sch[idx].closing : (sch.length && sch[sch.length - 1].fy < fy ? sch[sch.length - 1].closing : s.cost);
    }
    return { cost, book, charge };
  }, [q.data, fy]);

  function openEdit(a: Asset) {
    const s = q.data?.settings.get(a.asset_id);
    setF({ cost: s ? String(s.cost) : "", salvage: s ? String(s.salvage) : "0", method: s?.method ?? "slm", life: String(s?.life_years ?? 10), rate: String(s?.wdv_rate ?? 15), start: s?.start_date ?? a.purchase_date ?? "" });
    setEdit(a);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_asset_depreciation", {
      _asset_id: edit.asset_id, _cost: Number(f.cost), _salvage: Number(f.salvage || 0), _method: f.method,
      _life_years: Number(f.life), _wdv_rate: Number(f.rate), _start_date: f.start,
    });
    setSaving(false);
    if (error) return toast.error(error.code === "42501" ? "Only finance admins can change depreciation." : error.message.includes("check") ? "Check the values: salvage must be less than cost." : error.message);
    toast.success("Depreciation saved");
    setEdit(null);
    void qc.invalidateQueries({ queryKey: ["depreciation", societyId] });
  }

  const viewSettings = view ? q.data?.settings.get(view.asset_id) : undefined;

  return (
    <PageShell>
      <PageHeader title="Asset depreciation" description={`Financial year ${fy} (April–March). Schedules are for reports and the auditor; they are not posted to the books automatically.`} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[["Total cost", summary.cost], ["Book value (year end)", summary.book], [`Depreciation ${fy}`, summary.charge]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold tabular-nums">{q.isSuccess ? inr(v as number) : "—"}</p></div>
        ))}
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Loading assets…</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>Couldn't load assets.</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>Try again</Button></div>
        : q.data!.assets.length === 0 ? <p className="rounded-lg border p-6 text-center text-muted-foreground">No assets yet. Add assets under Operations → Assets first.</p>
        : <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {q.data!.assets.map((a) => {
            const s = q.data!.settings.get(a.asset_id);
            const cur = s ? depreciationSchedule(s).find((y) => y.fy === fy) : undefined;
            return (
              <li key={a.asset_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.category.replace("_", " ")}{s ? ` · ${s.method === "slm" ? `Straight line, ${s.life_years} yrs` : `WDV ${s.wdv_rate}%`} · cost ${inr(s.cost)}` : " · Not set up"}</p>
                </div>
                {cur && <p className="text-sm tabular-nums">This year {inr(cur.charge)}</p>}
                {s && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setView(a)}>Schedule</Button>}
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => openEdit(a)}>{s ? "Edit" : "Set up"}</Button>
              </li>
            );
          })}
        </ul>}

      <Dialog open={!!edit} onOpenChange={(o) => !saving && !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Depreciation — {edit?.name}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="d-cost">Cost (₹)</Label><Input id="d-cost" className="h-11" type="number" min="1" step="0.01" required value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="d-salv">Salvage value (₹)</Label><Input id="d-salv" className="h-11" type="number" min="0" step="0.01" value={f.salvage} onChange={(e) => setF({ ...f, salvage: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="d-start">Put to use on</Label><Input id="d-start" className="h-11" type="date" required max={new Date().toISOString().slice(0, 10)} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <fieldset className="flex gap-2"><legend className="mb-1.5 text-sm font-medium">Method</legend>
              {(["slm", "wdv"] as const).map((m) => <Button key={m} type="button" variant={f.method === m ? "default" : "outline"} className="min-h-11 flex-1" onClick={() => setF({ ...f, method: m })}>{m === "slm" ? "Straight line" : "Written-down value"}</Button>)}
            </fieldset>
            {f.method === "slm"
              ? <div className="space-y-1.5"><Label htmlFor="d-life">Useful life (years)</Label><Input id="d-life" className="h-11" type="number" min="1" max="60" required value={f.life} onChange={(e) => setF({ ...f, life: e.target.value })} /></div>
              : <div className="space-y-1.5"><Label htmlFor="d-rate">Rate per year (%)</Label><Input id="d-rate" className="h-11" type="number" min="0.01" max="99.99" step="0.01" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>}
            <DialogFooter><Button type="submit" className="min-h-11 w-full" disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Schedule — {view?.name}</DialogTitle></DialogHeader>
          {viewSettings && <table className="w-full text-sm tabular-nums">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Year</th><th className="text-right">Opening</th><th className="text-right">Charge</th><th className="text-right">Closing</th></tr></thead>
            <tbody>{depreciationSchedule(viewSettings).map((y) => <tr key={y.fy} className={`border-t ${y.fy === fy ? "font-semibold" : ""}`}><td className="py-1.5">{y.fy}</td><td className="text-right">{inr(y.opening)}</td><td className="text-right">{inr(y.charge)}</td><td className="text-right">{inr(y.closing)}</td></tr>)}</tbody>
          </table>}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
