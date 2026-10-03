import { useState } from "react";
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
const fmt = (v: string) => new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const errMsg = (e: { message?: string }) => {
  const m = e.message ?? "";
  if (m.includes("rate_limited")) return "Too many requests today. Try again tomorrow.";
  if (m.includes("invalid_transition")) return "This pass has already changed. Refresh and try again.";
  if (m.includes("42501") || m.includes("Not allowed")) return "You don't have permission to do that.";
  return m.length < 120 && m ? m : "Something went wrong. Please try again.";
};

function PassRow({ p, actions }: { p: Pass; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{KIND_LABEL[p.kind]}{p.flats?.flat_number ? ` · ${p.flats.flat_number}` : ""} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{p.status.replace("_", " ")}</span></p>
        <p className="text-sm text-muted-foreground">{fmt(p.valid_from)} – {fmt(p.valid_until)}{p.lift_required ? " · Service lift booked" : ""}</p>
        <p className="text-sm">{p.description}{p.contractor_name ? ` · ${p.contractor_name}` : ""}</p>
        {p.decision_reason && <p className="text-xs text-muted-foreground">Reason: {p.decision_reason}</p>}
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
    toast.success("Pass cancelled"); qc.invalidateQueries({ queryKey: ["my-passes"] });
  };
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <div className="rounded-2xl border p-4 text-sm">We couldn't load your passes. <Button variant="link" onClick={() => q.refetch()}>Retry</Button></div>;
  return (
    <div className="space-y-4">
      {q.data?.flatId ? <Button className="min-h-11" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Request a pass</Button>
        : <p className="text-sm text-muted-foreground">You need an active home in this society to request a pass.</p>}
      <List rows={q.data?.passes ?? []} empty="No passes yet." actions={(p) => ["pending", "approved"].includes(p.status) ? <Button variant="outline" className="min-h-11" onClick={() => void cancel(p.id)}>Cancel</Button> : null} />
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
    if (new Date(until) <= new Date(from)) return toast.error("End time must be after the start time.");
    setSaving(true);
    const { error } = await supabase.rpc("request_material_pass", {
      _flat_id: flatId, _kind: kind, _description: desc, _from: new Date(from).toISOString(), _until: new Date(until).toISOString(), _lift: lift, _contractor: contractor,
    });
    setSaving(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Request sent to the committee");
    setDesc(""); setFrom(""); setUntil(""); setLift(false); setContractor(""); onOpenChange(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request a pass</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5"><Label htmlFor="pk">Type</Label>
            <select id="pk" className="h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label htmlFor="pd">What is coming in or going out?</Label><Textarea id="pd" required minLength={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="pf">From</Label><Input id="pf" type="datetime-local" className="h-11" required value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pu">Until</Label><Input id="pu" type="datetime-local" className="h-11" required value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pc">Contractor or mover (optional)</Label><Input id="pc" className="h-11" maxLength={80} value={contractor} onChange={(e) => setContractor(e.target.value)} /></div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={lift} onChange={(e) => setLift(e.target.checked)} />Book the service lift for this time</label>
          <DialogFooter><Button type="submit" className="min-h-11 w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send request</Button></DialogFooter>
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
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <div className="rounded-2xl border p-4 text-sm">We couldn't load passes. <Button variant="link" onClick={() => q.refetch()}>Retry</Button></div>;
  const rows = q.data ?? [];
  const pending = rows.filter((p) => p.status === "pending");
  const lift = rows.filter((p) => p.lift_required && ["approved", "in_progress"].includes(p.status) && new Date(p.valid_until) > new Date());
  return (
    <div className="space-y-6">
      <section><h2 className="mb-2 font-semibold">Waiting for approval ({pending.length})</h2>
        <List rows={pending} empty="Nothing waiting." actions={(p) => <div className="flex gap-2">
          <Button className="min-h-11" disabled={busy === p.id} onClick={() => void decide(p, true)}>Approve</Button>
          <Button variant="outline" className="min-h-11" disabled={busy === p.id} onClick={() => setReject(p)}>Reject</Button></div>} /></section>
      <section><h2 className="mb-2 font-semibold">Service lift schedule ({lift.length})</h2><List rows={lift} empty="No upcoming lift bookings." /></section>
      <section><h2 className="mb-2 font-semibold">All passes</h2><List rows={rows.filter((p) => p.status !== "pending")} empty="No passes yet." /></section>
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent><DialogHeader><DialogTitle>Reject pass</DialogTitle></DialogHeader>
          <Label htmlFor="rr">Reason (shown to the resident)</Label>
          <Textarea id="rr" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter><Button className="min-h-11" variant="destructive" disabled={!reason.trim() || !!busy} onClick={() => reject && void decide(reject, false, reason)}>Reject</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GuardPassesCard({ societyId }: { societyId: string | null }) {
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
    toast.success(action === "in" ? "Marked as arrived" : "Marked as finished");
    qc.invalidateQueries({ queryKey: ["guard-passes", societyId] });
  };
  if (!societyId || q.isLoading || !q.data?.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" />Material &amp; move passes today</h2>
      <List rows={q.data} empty="" actions={(p) => p.status === "approved"
        ? <Button className="min-h-11" onClick={() => void mark(p, "in")}>Let in</Button>
        : <Button variant="outline" className="min-h-11" onClick={() => void mark(p, "done")}>Finished</Button>} />
    </section>
  );
}
