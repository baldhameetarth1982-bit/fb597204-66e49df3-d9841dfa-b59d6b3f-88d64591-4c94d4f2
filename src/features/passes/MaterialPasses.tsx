import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { localeTag, tu } from "@/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Pass = {
  id: string; flat_id: string; kind: string; description: string; valid_from: string; valid_until: string;
  lift_required: boolean; contractor_name: string | null; status: string; decision_reason: string | null;
  flats?: { flat_number: string } | null;
};
export const KIND_LABEL: Record<string, string> = {
  material_in: "Material in", material_out: "Material out", construction: "Construction / renovation",
  move_in: "Move in", move_out: "Move out",
};
const SEL = "id,flat_id,kind,description,valid_from,valid_until,lift_required,contractor_name,status,decision_reason,flats(flat_number)";
const fmt = (v: string) => new Date(v).toLocaleString(localeTag(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", numberingSystem: "latn" });
const tr = (k: string) => i18n.t(k) as string;
export const kindLabel = (k: string) => (KIND_LABEL[k] ? tr(`mp.k.${k}`) : k);
const STATUS_KEY: Record<string, string> = { pending: "vs.st.awaiting", approved: "vs.st.approved", in_progress: "hd.st.in_progress", completed: "am.st.completed", rejected: "inc.st.rejected", cancelled: "rbills.cancelled", expired: "cm.st.expired" };
const statusLabel = (s: string) => (STATUS_KEY[s] ? tr(STATUS_KEY[s]) : s.replace("_", " "));
const errMsg = (e: { message?: string }) => {
  const m = e.message ?? "";
  if (m.includes("rate_limited")) return tr("mp.e.rate");
  if (m.includes("invalid_transition")) return tr("mp.e.changed");
  if (m.includes("42501") || m.includes("Not allowed")) return tr("hd.err.denied");
  return tr("errors.generic");
};

function PassRow({ p, actions }: { p: Pass; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{kindLabel(p.kind)}{p.flats?.flat_number ? ` · ${p.flats.flat_number}` : ""} <span className="ms-1 rounded-full bg-muted px-2 py-0.5 text-xs">{statusLabel(p.status)}</span></p>
        <p className="text-sm text-muted-foreground">{fmt(p.valid_from)} – {fmt(p.valid_until)}{p.lift_required ? ` · ${tr("mp.lift")}` : ""}</p>
        <p className="text-sm">{p.description}{p.contractor_name ? ` · ${p.contractor_name}` : ""}</p>
        {p.decision_reason && <p className="text-xs text-muted-foreground">{tr("cm.reason")}: {p.decision_reason}</p>}
      </div>
      {actions}
    </li>
  );
}

function List({ rows, empty, actions }: { rows: Pass[]; empty: string; actions?: (p: Pass) => React.ReactNode }) {
  if (!rows.length) return <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{rows.map((p) => <PassRow key={p.id} p={p} actions={actions?.(p)} />)}</ul>;
}

export function ResidentPasses() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["my-passes"],
    queryFn: async () => {
      const { data: flat, error: fe } = await supabase.rpc("_my_active_flat" as never);
      if (fe) throw fe;
      const flatId = (flat as unknown as { flat_id: string }[] | null)?.[0]?.flat_id ?? null;
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("material_passes").select(SEL).eq("requested_by", u.user?.id ?? "").order("valid_from", { ascending: false }).limit(100);
      if (error) throw error;
      return { flatId, passes: data as unknown as Pass[] };
    },
  });
  const cancel = async (id: string) => {
    const { error } = await supabase.rpc("cancel_material_pass", { _pass_id: id });
    if (error) return toast.error(errMsg(error));
    toast.success(tu("op.pass_cancelled")); qc.invalidateQueries({ queryKey: ["my-passes"] });
  };
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{tu("common.loading")}</p>;
  if (q.error) return <div className="rounded-2xl border p-4 text-sm">{tu("op.we_couldn_t_load_your_2")} <Button variant="link" onClick={() => q.refetch()}>{tu("common.retry")}</Button></div>;
  return (
    <div className="space-y-4">
      {q.data?.flatId ? <Button className="min-h-11" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />{tu("op.request_a_pass")}</Button>
        : <p className="text-sm text-muted-foreground">{tu("op.you_need_an_active_home")}</p>}
      <List rows={q.data?.passes ?? []} empty="No passes yet." actions={(p) => ["pending", "approved"].includes(p.status) ? <Button variant="outline" className="min-h-11" onClick={() => void cancel(p.id)}>{tu("common.cancel")}</Button> : null} />
      {q.data?.flatId && <RequestDialog open={open} onOpenChange={setOpen} flatId={q.data.flatId} onDone={() => qc.invalidateQueries({ queryKey: ["my-passes"] })} />}
    </div>
  );
}

function RequestDialog({ open, onOpenChange, flatId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; flatId: string; onDone: () => void }) {
  const [kind, setKind] = useState("material_in");
  const [desc, setDesc] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [lift, setLift] = useState(false);
  const [contractor, setContractor] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (new Date(until) <= new Date(from)) return toast.error(tu("op.end_time_must_be_after"));
    setSaving(true);
    const { error } = await supabase.rpc("request_material_pass", {
      _flat_id: flatId, _kind: kind, _description: desc, _from: new Date(from).toISOString(), _until: new Date(until).toISOString(), _lift: lift, _contractor: contractor,
    });
    setSaving(false);
    if (error) return toast.error(errMsg(error));
    toast.success(tu("op.request_sent_to_the_committee"));
    setDesc(""); setFrom(""); setUntil(""); setLift(false); setContractor(""); onOpenChange(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{tu("op.request_a_pass")}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5"><Label htmlFor="pk">{tu("cm.type")}</Label>
            <select id="pk" className="h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label htmlFor="pd">{tu("op.what_is_coming_in_or")}</Label><Textarea id="pd" required minLength={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="pf">{tu("common.from")}</Label><Input id="pf" type="datetime-local" className="h-11" required value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pu">{tu("rgp.until")}</Label><Input id="pu" type="datetime-local" className="h-11" required value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pc">{tu("op.contractor_or_mover_optional")}</Label><Input id="pc" className="h-11" maxLength={80} value={contractor} onChange={(e) => setContractor(e.target.value)} /></div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={lift} onChange={(e) => setLift(e.target.checked)} />{tu("op.book_the_service_lift_for")}</label>
          <DialogFooter><Button type="submit" className="min-h-11 w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("op.send_request")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CommitteePasses({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const [reject, setReject] = useState<Pass | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["society-passes", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("material_passes").select(SEL).eq("society_id", societyId).order("valid_from", { ascending: false }).limit(300);
      if (error) throw error;
      return data as unknown as Pass[];
    },
  });
  const decide = async (p: Pass, approve: boolean, why = "") => {
    setBusy(p.id);
    const { error } = await supabase.rpc("decide_material_pass", { _pass_id: p.id, _approve: approve, _reason: why });
    setBusy(null);
    if (error) return toast.error(errMsg(error));
    toast.success(approve ? "Pass approved" : "Pass rejected");
    setReject(null); setReason(""); qc.invalidateQueries({ queryKey: ["society-passes", societyId] });
  };
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{tu("common.loading")}</p>;
  if (q.error) return <div className="rounded-2xl border p-4 text-sm">{tu("op.we_couldn_t_load_passes")} <Button variant="link" onClick={() => q.refetch()}>{tu("common.retry")}</Button></div>;
  const rows = q.data ?? [];
  const pending = rows.filter((p) => p.status === "pending");
  const lift = rows.filter((p) => p.lift_required && ["approved", "in_progress"].includes(p.status) && new Date(p.valid_until) > new Date());
  return (
    <div className="space-y-6">
      <section><h2 className="mb-2 font-semibold">{tu("op.waiting_for_approval")}{pending.length})</h2>
        <List rows={pending} empty="Nothing waiting." actions={(p) => <div className="flex gap-2">
          <Button className="min-h-11" disabled={busy === p.id} onClick={() => void decide(p, true)}>{tu("vs.approve")}</Button>
          <Button variant="outline" className="min-h-11" disabled={busy === p.id} onClick={() => setReject(p)}>{tu("el.a.reject")}</Button></div>} /></section>
      <section><h2 className="mb-2 font-semibold">{tu("op.service_lift_schedule")}{lift.length})</h2><List rows={lift} empty="No upcoming lift bookings." /></section>
      <section><h2 className="mb-2 font-semibold">{tu("op.all_passes")}</h2><List rows={rows.filter((p) => p.status !== "pending")} empty="No passes yet." /></section>
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent><DialogHeader><DialogTitle>{tu("op.reject_pass")}</DialogTitle></DialogHeader>
          <Label htmlFor="rr">{tu("op.reason_shown_to_the_resident")}</Label>
          <Textarea id="rr" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter><Button className="min-h-11" variant="destructive" disabled={!reason.trim() || !!busy} onClick={() => reject && void decide(reject, false, reason)}>{tu("el.a.reject")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GuardPassesCard({ societyId }: { societyId: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["guard-passes", societyId],
    queryFn: async () => {
      const now = new Date(); const soon = new Date(now.getTime() + 12 * 3600e3);
      const { data, error } = await supabase.from("material_passes").select(SEL).eq("society_id", societyId!)
        .in("status", ["approved", "in_progress"]).lte("valid_from", soon.toISOString()).gte("valid_until", now.toISOString()).order("valid_from").limit(50);
      if (error) throw error;
      return data as unknown as Pass[];
    },
  });
  const mark = async (p: Pass, action: "in" | "done") => {
    const { error } = await supabase.rpc("guard_mark_material_pass", { _pass_id: p.id, _action: action });
    if (error) return toast.error(errMsg(error));
    toast.success(action === "in" ? t("mp.arrived") : t("mp.done"));
    qc.invalidateQueries({ queryKey: ["guard-passes", societyId] });
  };
  if (!societyId || q.isLoading || !q.data?.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" />{t("mp.title")}</h2>
      <List rows={q.data} empty="" actions={(p) => p.status === "approved"
        ? <Button className="min-h-11" onClick={() => void mark(p, "in")}>{t("gd.letIn")}</Button>
        : <Button variant="outline" className="min-h-11" onClick={() => void mark(p, "done")}>{t("mp.finished")}</Button>} />
    </section>
  );
}
