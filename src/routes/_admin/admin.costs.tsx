import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTION_MESSAGES } from "@/lib/super-admin-ui";
import { platformOverviewQuery, grossProfit, inr, COST_CATEGORIES } from "@/lib/platform-overview";

export const Route = createFileRoute("/_admin/admin/costs")({
  head: () => ({ meta: [
    { title: "Revenue & Costs — Super Admin · SociyoHub" },
    { name: "description", content: "SociyoHub subscription revenue, platform operating costs and gross profit." },
    { property: "og:title", content: "Revenue & Costs — Super Admin · SociyoHub" },
    { property: "og:description", content: "SociyoHub subscription revenue, platform operating costs and gross profit." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: CostsPage,
});

type Entry = { id: string; period_month: string; category: string; amount_inr: number; note: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
const catLabel = (k: string) => COST_CATEGORIES.find((c) => c.key === k)?.label ?? k;
const msg = (s: string) => ACTION_MESSAGES[s] ?? "Couldn't save. Try again.";

function CostsPage() {
  const qc = useQueryClient();
  const ov = useQuery(platformOverviewQuery);
  const entries = useQuery({
    queryKey: ["admin-platform-costs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("platform_cost_entries")
        .select("id,period_month,category,amount_inr,note,created_at,voided_at,void_reason")
        .order("period_month", { ascending: false }).order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("load_failed");
      return (data ?? []) as Entry[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-platform-costs"] }); qc.invalidateQueries({ queryKey: platformOverviewQuery.queryKey }); };

  const month = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({ period: month, category: "infrastructure", amount: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [rate, setRate] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  async function addCost(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.error("Enter an amount above zero.");
    setSaving(true);
    const { data, error } = await supabase.rpc("admin_record_platform_cost" as any, { _period: `${form.period}-01`, _category: form.category, _amount: amount, _note: form.note || null });
    setSaving(false);
    const st = (data as any)?.status;
    if (error || st !== "ok") return toast.error(msg(st));
    toast.success("Cost recorded");
    setForm((f) => ({ ...f, amount: "", note: "" }));
    refresh();
  }

  async function voidCost(id: string) {
    const reason = window.prompt("Why remove this cost? (kept in history)");
    if (!reason) return;
    const { data, error } = await supabase.rpc("admin_void_platform_cost" as any, { _id: id, _reason: reason });
    const st = (data as any)?.status;
    if (error || st !== "ok") return toast.error(msg(st));
    toast.success("Cost removed — kept in history");
    refresh();
  }

  async function saveRate(e: React.FormEvent) {
    e.preventDefault();
    const value = rate.trim() === "" ? null : Number(rate);
    if (value !== null && !(value >= 0)) return toast.error("Enter a valid amount, or leave empty to clear.");
    setSavingRate(true);
    const { data, error } = await supabase.rpc("admin_set_ai_cost_rate" as any, { _rate: value, _reason: rateReason });
    setSavingRate(false);
    const st = (data as any)?.status;
    if (error || st !== "ok") return toast.error(msg(st));
    toast.success("AI cost rate saved");
    setRate(""); setRateReason("");
    refresh();
  }

  const o = ov.data;
  const gp = o ? grossProfit(o) : null;

  return (
    <PageShell>
      <PageHeader title="Revenue & costs" description="SociyoHub's own money only. Society maintenance collections are never part of these figures." />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">This month</h2>
            {!o || !gp ? <div className="p-4"><Skeleton className="h-40" /></div> : (
              <dl className="divide-y text-sm">
                {([
                  ["Gross subscription revenue (live Razorpay payments)", inr(o.revenue.gross_inr)],
                  ["Refunds processed", `− ${inr(o.revenue.refunds_inr)}`],
                  ["Net subscription revenue", inr(o.revenue.net_inr)],
                  ...COST_CATEGORIES.map((c) => [c.label, o.costs.by_category[c.key] !== undefined ? `− ${inr(o.costs.by_category[c.key])}` : c.key === "ai" && o.costs.ai_estimate_inr !== null ? `− ${inr(o.costs.ai_estimate_inr)} (estimate)` : "Not configured"]),
                  ["Gross profit", inr(gp.profit)],
                  ["Gross margin", gp.margin === null ? "Not meaningful (no revenue)" : `${gp.margin.toFixed(1)}%`],
                  ["Lifetime net subscription revenue", inr(o.revenue.lifetime_net_inr)],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
            )}
            {gp && gp.missing.length > 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Gross profit is incomplete — not configured: {gp.missing.join(", ")}.</p>}
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Recorded costs</h2>
            {entries.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : entries.isError ? (
              <p className="p-4 text-sm text-destructive">Couldn't load costs.</p>
            ) : (entries.data ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No costs recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {entries.data!.map((e) => (
                  <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className={e.voided_at ? "font-medium line-through text-muted-foreground" : "font-medium"}>{catLabel(e.category)} · {inr(Number(e.amount_inr))}</p>
                      <p className="truncate text-xs text-muted-foreground">{new Date(e.period_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}{e.note ? ` · ${e.note}` : ""}{e.voided_at ? ` · removed: ${e.void_reason}` : ""}</p>
                    </div>
                    {!e.voided_at && <Button variant="ghost" className="min-h-11" onClick={() => voidCost(e.id)}>Remove</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6 lg:col-span-5">
          <form onSubmit={addCost} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Record a platform cost</h2>
            <p className="text-xs text-muted-foreground">Enter real bills only (hosting, AI, messaging, storage). Every entry is kept in the audit log.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="c-month">Month</Label><Input id="c-month" type="month" required value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className="min-h-11" /></div>
              <div className="space-y-1"><Label htmlFor="c-amt">Amount (₹)</Label><Input id="c-amt" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="min-h-11" /></div>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{COST_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label htmlFor="c-note">Note (optional)</Label><Input id="c-note" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="min-h-11" /></div>
            <Button type="submit" className="min-h-11 w-full" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record cost"}</Button>
          </form>

          <form onSubmit={saveRate} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">AI cost estimate</h2>
            <p className="text-xs text-muted-foreground">
              Current rate: {o?.costs.ai_rate_inr != null ? `₹${o.costs.ai_rate_inr} per request` : "not set"}. Used only when no actual AI bill is recorded for the month. Leave empty to clear.
            </p>
            <div className="space-y-1"><Label htmlFor="r-rate">₹ per AI request</Label><Input id="r-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="min-h-11" /></div>
            <div className="space-y-1"><Label htmlFor="r-reason">Reason</Label><Input id="r-reason" required minLength={3} value={rateReason} onChange={(e) => setRateReason(e.target.value)} className="min-h-11" /></div>
            <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={savingRate}>{savingRate ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save rate"}</Button>
          </form>
        </aside>
      </div>
    </PageShell>
  );
}
