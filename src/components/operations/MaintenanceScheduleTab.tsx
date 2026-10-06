import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Hammer } from "lucide-react";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cancelMaintenance, scheduleMaintenance } from "@/lib/role-access.functions";
import { isOverdue } from "@/lib/overdue";
import { tu } from "@/lib/i18n";

const LABEL: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", paused: "Paused", done: "Done", cancelled: "Cancelled" };
const mutOpts = { networkMode: "always" as const, retry: false };
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Committee schedules maintenance for one staff member; staff progress it from their own workspace. */
export function MaintenanceScheduleTab() {
  const { societyId: sid } = useSocietyId();
  const qc = useQueryClient();
  const schedule = useServerFn(scheduleMaintenance);
  const cancel = useServerFn(cancelMaintenance);
  const [form, setForm] = useState({ staffId: "", assetId: "", title: "", due: new Date().toISOString().slice(0, 10), instructions: "" });

  const opts = useQuery({
    queryKey: ["maint-options", sid], enabled: !!sid,
    queryFn: async () => {
      const [st, as] = await Promise.all([
        supabase.from("society_staff").select("id, full_name, job_type").eq("society_id", sid!).eq("is_active", true).order("full_name"),
        supabase.from("society_assets").select("id, name, location").eq("society_id", sid!).order("name").limit(500),
      ]);
      if (st.error || as.error) throw new Error("Could not load staff and assets.");
      return { staff: st.data, assets: as.data };
    },
  });
  const list = useQuery({
    queryKey: ["maint-tasks", sid], enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase.from("maintenance_tasks")
        .select("id, title, due_on, status, staff_note, cancel_reason, staff_id, asset_id").eq("society_id", sid!).order("due_on", { ascending: false }).limit(100);
      if (error) throw new Error("Could not load maintenance.");
      return data;
    },
  });
  const add = useMutation({ ...mutOpts,
    mutationFn: () => schedule({ data: { staffId: form.staffId, assetId: form.assetId || null, title: form.title, due: form.due, instructions: form.instructions || undefined } }),
    onSuccess: () => { toast.success(tu("op.maintenance_scheduled")); setForm((f) => ({ ...f, title: "", instructions: "" })); qc.invalidateQueries({ queryKey: ["maint-tasks"] }); },
    onError: (e) => toast.error(msg(e)) });
  const stop = useMutation({ ...mutOpts,
    mutationFn: (v: { id: string; reason: string }) => cancel({ data: v }),
    onSuccess: () => { toast.success(tu("rbills.cancelled")); qc.invalidateQueries({ queryKey: ["maint-tasks"] }); }, onError: (e) => toast.error(msg(e)) });

  const staffName = (id: string) => opts.data?.staff.find((s) => s.id === id)?.full_name ?? "Staff";
  const assetName = (id: string | null) => (id ? opts.data?.assets.find((a) => a.id === id)?.name : null);

  return (
    <div className="space-y-4">
      <SectionCard title={tu("op.schedule_maintenance")} description={tu("op.assigned_staff_see_it_under")} icon={Hammer}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div><Label htmlFor="ms-staff">{tu("op.staff_member")}</Label>
            <select id="ms-staff" required className="flex min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
              <option value="">{tu("op.choose")}</option>{opts.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select></div>
          <div><Label htmlFor="ms-asset">{tu("op.asset_optional")}</Label>
            <select id="ms-asset" className="flex min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
              <option value="">{tu("el.a.none")}</option>{opts.data?.assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.location ? ` · ${a.location}` : ""}</option>)}
            </select></div>
          <div><Label htmlFor="ms-title">{tu("op.job")}</Label><Input id="ms-title" required minLength={3} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label htmlFor="ms-due">{tu("op.due_on")}</Label><Input id="ms-due" type="date" required value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="ms-ins">{tu("op.instructions_optional")}</Label><Textarea id="ms-ins" maxLength={1000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
          <div className="sm:col-span-2"><Button type="submit" className="min-h-11" disabled={add.isPending || !form.staffId}>{tu("op.schedule")}</Button></div>
        </form>
      </SectionCard>
      <SectionCard title={tu("op.maintenance_jobs")} icon={Hammer}>
        {list.error ? <p role="alert" className="text-sm text-destructive">{msg(list.error)}</p> : !list.data ? <p className="text-sm text-muted-foreground">{tu("common.loading")}</p>
          : list.data.length === 0 ? <EmptyState icon={Hammer} title={tu("op.no_maintenance_scheduled")} /> : (
          <ul className="divide-y rounded-lg border">{list.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{m.title}</p>
                <p className="text-muted-foreground">{staffName(m.staff_id)} · due {m.due_on}{assetName(m.asset_id) ? ` · ${assetName(m.asset_id)}` : ""}</p>
                {(m.staff_note || m.cancel_reason) && <p className="text-muted-foreground">{m.cancel_reason ?? m.staff_note}</p>}</div>
              <div className="flex items-center gap-2">{isOverdue(m.due_on, !["done", "cancelled"].includes(m.status)) && <Badge variant="destructive">{tu("bills.overdue")}</Badge>}<Badge variant="outline">{LABEL[m.status] ?? m.status}</Badge>
                {!["done", "cancelled"].includes(m.status) && (
                  <Button size="sm" variant="outline" className="min-h-11" disabled={stop.isPending} onClick={() => {
                    const reason = window.prompt("Reason for cancelling (at least 5 characters)")?.trim();
                    if (reason && reason.length >= 5) stop.mutate({ id: m.id, reason });
                  }}>{tu("common.cancel")}</Button>)}
              </div>
            </li>
          ))}</ul>
        )}
      </SectionCard>
    </div>
  );
}
