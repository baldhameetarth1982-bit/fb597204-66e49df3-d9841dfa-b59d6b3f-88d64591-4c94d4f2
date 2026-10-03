// Helpdesk reports: aggregates come only from the helpdesk_report RPC (server-resolved society + scope).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { opsErrorMessage } from "./OperationsTabs";

interface Report {
  scope: string; total: number; open: number; resolved: number; overdue: number; escalated: number; on_hold: number;
  reopened: number; follow_ups: number; avg_resolution_hours: number | null; sla_met: number; sla_breached: number;
  rating_count: number; rating_avg: number | null;
  by_status: Record<string, number>; by_priority: Record<string, number>; by_category: Record<string, number>;
  by_staff: { id: string | null; name: string; count: number; open: number }[];
  by_vendor: { id: string; name: string; count: number; open: number }[];
  problem_assets: { id: string; name: string; location: string | null; count: number }[];
  by_month: { month: string; created: number; resolved: number }[];
}
const ALL = "__all";
const STATUS = ["open", "in_progress", "on_hold", "reopened", "resolved", "closed", "cancelled", "rejected"];
const PRIORITY = ["low", "medium", "high", "urgent"];
const CATEGORY = [["complaint", "Complaint"], ["maintenance", "Maintenance"], ["daily_help", "Daily help"], ["lost_found", "Lost & found"]] as const;
const FLAGS = [["overdue", "Overdue"], ["escalated", "Escalated"], ["on_hold", "On hold"], ["reopened", "Reopened"]] as const;
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Filters = { from: string; to: string; status: string; priority: string; category: string; staff: string; vendor: string; asset: string; flag: string };
const EMPTY: Filters = { from: "", to: "", status: ALL, priority: ALL, category: ALL, staff: ALL, vendor: ALL, asset: ALL, flag: ALL };
const toArgs = (f: Filters) => {
  const v = (x: string) => (x === ALL || x === "" ? null : x);
  return { _from: v(f.from), _to: v(f.to), _status: v(f.status), _priority: v(f.priority), _category: v(f.category), _staff: v(f.staff), _vendor: v(f.vendor), _asset: v(f.asset), _flag: v(f.flag) } as never;
};

function Pick({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-11"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All</SelectItem>{options.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{value}</p>{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
function Bars({ title, data }: { title: string; data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  return (
    <section className="rounded-2xl border bg-card p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {!data.length ? <p className="text-sm text-muted-foreground">No requests.</p> : (
        <ul className="space-y-1.5">
          {data.map(([k, n]) => (
            <li key={k} className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-2 text-sm">
              <span className="truncate">{k}</span>
              <span className="h-2 rounded-full bg-muted"><span className="block h-2 origin-left rounded-full bg-primary" style={{ transform: `scaleX(${n / max})` }} /></span>
              <span className="text-right tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HelpdeskReportsTab() {
  const sid = useSocietyId().societyId;
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const lists = useQuery({
    queryKey: ["ops", "report-lists", sid], enabled: !!sid, staleTime: 60_000,
    queryFn: async () => {
      const [s, v, a] = await Promise.all([
        supabase.from("society_staff").select("id, full_name").eq("society_id", sid!).order("full_name").limit(300),
        supabase.from("finance_vendors").select("id, name").eq("society_id", sid!).order("name").limit(300),
        supabase.from("society_assets").select("id, name").eq("society_id", sid!).order("name").limit(300),
      ]);
      return { staff: (s.data ?? []).map((r) => [r.id, r.full_name] as const), vendors: (v.data ?? []).map((r) => [r.id, r.name] as const), assets: (a.data ?? []).map((r) => [r.id, r.name] as const) };
    },
  });
  const q = useQuery({
    queryKey: ["ops", "helpdesk-report", sid, applied], enabled: !!sid, placeholderData: (p) => p,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_report", toArgs(applied));
      if (error) throw error;
      return data as unknown as Report;
    },
  });
  const exp = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_report_rows", toArgs(applied));
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({
        "Request #": Number(r.ticket_no), Raised: r.created_at.slice(0, 10), Subject: r.subject, Category: r.category ?? "", Priority: r.priority ?? "",
        Status: r.status, Staff: r.staff_name ?? "", Vendor: r.vendor_name ?? "", Asset: r.asset_name ?? "",
        "SLA due": r.sla_due_at ? r.sla_due_at.slice(0, 16).replace("T", " ") : "", Resolved: r.resolved_at ? r.resolved_at.slice(0, 16).replace("T", " ") : "",
        Overdue: r.overdue ? "Yes" : "No", "Escalation level": r.escalation_level ?? 0, Reopened: r.reopened_count ?? 0, Rating: r.rating ?? "",
      }));
      if (!rows.length) throw new Error("empty");
      const { writeSafeWorkbook } = await import("@/lib/spreadsheet-safety");
      writeSafeWorkbook(rows, "Helpdesk", `helpdesk-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
      return rows.length;
    },
    onSuccess: (n) => toast.success(`Exported ${n} request${n === 1 ? "" : "s"}`),
    onError: (e) => toast.error(String((e as Error).message) === "empty" ? "Nothing to export for these filters." : opsErrorMessage(e)),
  });
  const r = q.data;
  const slaTotal = r ? r.sla_met + r.sla_breached : 0;
  const set = (k: keyof Filters) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <section className="space-y-3">
      <form className="grid grid-cols-2 gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
        <div className="space-y-1"><Label htmlFor="hr-from">From</Label><Input id="hr-from" type="date" className="h-11" value={draft.from} onChange={(e) => set("from")(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="hr-to">To</Label><Input id="hr-to" type="date" className="h-11" value={draft.to} onChange={(e) => set("to")(e.target.value)} /></div>
        <Pick id="hr-st" label="Status" value={draft.status} onChange={set("status")} options={STATUS.map((s) => [s, pretty(s)] as const)} />
        <Pick id="hr-pr" label="Priority" value={draft.priority} onChange={set("priority")} options={PRIORITY.map((s) => [s, pretty(s)] as const)} />
        <Pick id="hr-ca" label="Category" value={draft.category} onChange={set("category")} options={CATEGORY} />
        <Pick id="hr-fl" label="Show only" value={draft.flag} onChange={set("flag")} options={FLAGS} />
        <Pick id="hr-sf" label="Staff" value={draft.staff} onChange={set("staff")} options={lists.data?.staff ?? []} />
        <Pick id="hr-vd" label="Vendor" value={draft.vendor} onChange={set("vendor")} options={lists.data?.vendors ?? []} />
        <Pick id="hr-as" label="Asset" value={draft.asset} onChange={set("asset")} options={lists.data?.assets ?? []} />
        <div className="col-span-2 flex items-end gap-2 sm:col-span-3">
          <Button type="submit" className="min-h-11 flex-1 rounded-xl" disabled={q.isFetching}>{q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}</Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>Reset</Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={exp.isPending || !r?.total} onClick={() => exp.mutate()}>
            {exp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Export
          </Button>
        </div>
      </form>

      {!sid || q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={opsErrorMessage(q.error)} onRetry={() => q.refetch()} />
        : !r || !r.total ? <ListEmpty icon={BarChart3} title="No requests match">Try a wider date range or fewer filters.</ListEmpty> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Requests" value={r.total} hint={`${r.open} open · ${r.resolved} resolved`} />
            <Stat label="Overdue now" value={r.overdue} />
            <Stat label="Average time to resolve" value={r.avg_resolution_hours == null ? "—" : r.avg_resolution_hours < 48 ? `${r.avg_resolution_hours} h` : `${Math.round(r.avg_resolution_hours / 24)} days`} />
            <Stat label="Within target time" value={slaTotal ? `${Math.round((r.sla_met / slaTotal) * 100)}%` : "—"} hint={slaTotal ? `${r.sla_met} met · ${r.sla_breached} missed` : "No target times yet"} />
            <Stat label="Escalated" value={r.escalated} />
            <Stat label="On hold" value={r.on_hold} />
            <Stat label="Reopened / follow-ups" value={`${r.reopened} / ${r.follow_ups}`} />
            <Stat label="Resident rating" value={r.rating_count >= 3 && r.rating_avg != null ? `${r.rating_avg}/5` : "—"} hint={r.rating_count >= 3 ? `${r.rating_count} ratings` : `${r.rating_count} rating${r.rating_count === 1 ? "" : "s"} — too few for a score`} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Bars title="By status" data={Object.entries(r.by_status).map(([k, n]) => [pretty(k), n])} />
            <Bars title="By priority" data={Object.entries(r.by_priority).map(([k, n]) => [pretty(k), n])} />
            <Bars title="By category" data={Object.entries(r.by_category).map(([k, n]) => [CATEGORY.find((c) => c[0] === k)?.[1] ?? pretty(k), n])} />
            <Bars title="By staff" data={r.by_staff.map((s) => [`${s.name}${s.open ? ` (${s.open} open)` : ""}`, s.count])} />
            {r.scope === "society" && <Bars title="By vendor" data={r.by_vendor.map((s) => [`${s.name}${s.open ? ` (${s.open} open)` : ""}`, s.count])} />}
            <Bars title="Repeat problems (assets with 2+ requests)" data={r.problem_assets.map((a) => [`${a.name}${a.location ? ` · ${a.location}` : ""}`, a.count])} />
          </div>
          <section className="overflow-x-auto rounded-2xl border bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold">By month</h3>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Month</th><th className="text-right">Raised</th><th className="text-right">Resolved</th></tr></thead>
              <tbody>{r.by_month.map((m) => <tr key={m.month} className="border-t"><td className="py-1.5">{m.month}</td><td className="text-right tabular-nums">{m.created}</td><td className="text-right tabular-nums">{m.resolved}</td></tr>)}</tbody></table>
          </section>
          <p className="text-xs text-muted-foreground">Counts come straight from Helpdesk requests. Exports leave out descriptions, resident details and AI text, and every export is recorded.</p>
        </>
      )}
    </section>
  );
}
