// Committee security panel: decisions needed, restricted list, incidents, SOS.
// Ad-free critical surface.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { categoryLabel, fmtTime, gateErrorMessage } from "@/lib/visitors";
import { HardwareNote, ReasonSheet, SosAlertsCard } from "./GateOps";

type Tab = "review" | "restricted" | "incidents";

export function SecurityAdminPanel({ societyId, onChanged }: { societyId: string; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("review");
  return (
    <section aria-label="Security" className="space-y-3">
      <SosAlertsCard />
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {([["review", "Decisions"], ["restricted", "Restricted list"], ["incidents", "Incidents"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-xl text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "review" && <ReviewList societyId={societyId} onChanged={onChanged} />}
      {tab === "restricted" && <RestrictedList societyId={societyId} />}
      {tab === "incidents" && <IncidentList societyId={societyId} />}
      <HardwareNote />
    </section>
  );
}

interface ReviewRow { id: string; visitor_name: string; category: string; flat_number: string | null; restriction_id: string | null; expected_at: string | null; created_at: string; purpose: string | null }
function ReviewList({ societyId, onChanged }: { societyId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [approveRestricted, setApproveRestricted] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["committee-review", societyId],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("visitors")
        .select("id, visitor_name, category, flat_number, restriction_id, expected_at, created_at, purpose")
        .eq("society_id", societyId).eq("status", "awaiting")
        .or("category.eq.mover,restriction_id.not.is.null")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });
  async function decide(id: string, action: "approve" | "deny", reason = "") {
    if (busy) return false;
    setBusy(id);
    const { error } = await supabase.rpc("admin_visitor_decide", { _id: id, _action: action, _reason: reason });
    setBusy(null);
    qc.invalidateQueries({ queryKey: ["committee-review"] });
    onChanged();
    if (error) { toast.error(gateErrorMessage(error)); return false; }
    toast.success(action === "approve" ? "Approved — guard can let them in" : "Denied");
    return true;
  }
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto" />;
  if (q.isError) return <p className="text-sm text-destructive">{gateErrorMessage(q.error)}</p>;
  if (!q.data?.length) return <p className="text-sm text-muted-foreground text-center py-4">No movers or restricted visitors waiting.</p>;
  return (
    <>
      <ul className="space-y-2">
        {q.data.map((v) => (
          <li key={v.id}><Card className={cn("rounded-2xl", v.restriction_id && "border-destructive/40")}><CardContent className="p-4 space-y-3">
            <div>
              <p className="font-semibold flex items-center gap-2">{v.restriction_id && <ShieldAlert className="h-4 w-4 text-destructive" />}{v.visitor_name}</p>
              <p className="text-xs text-muted-foreground">
                {v.restriction_id ? "On restricted list" : categoryLabel(v.category)}{v.flat_number ? ` · House ${v.flat_number}` : ""} · {fmtTime(v.expected_at ?? v.created_at)}{v.purpose ? ` · ${v.purpose}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 h-11 rounded-xl" disabled={busy === v.id}
                onClick={() => (v.restriction_id ? setApproveRestricted(v.id) : void decide(v.id, "approve"))}>Approve</Button>
              <Button variant="outline" className="flex-1 h-11 rounded-xl" disabled={busy === v.id} onClick={() => void decide(v.id, "deny")}>Deny</Button>
            </div>
          </CardContent></Card></li>
        ))}
      </ul>
      <ReasonSheet title="Allow restricted visitor" hint="This person is on the restricted list. Your reason is recorded as a separate override."
        open={!!approveRestricted} onOpenChange={(o) => !o && setApproveRestricted(null)}
        onSubmit={(r) => decide(approveRestricted!, "approve", r)} />
    </>
  );
}

interface RestrictionRow { id: string; visitor_name: string; phone: string | null; reason: string; is_active: boolean; created_at: string }
function RestrictedList({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["restrictions", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("visitor_restrictions").select("id, visitor_name, phone, reason, is_active, created_at")
        .eq("society_id", societyId).order("is_active", { ascending: false }).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as RestrictionRow[];
    },
  });
  async function save(id: string | null, name: string, phone: string | null, reason: string, active: boolean) {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_upsert_visitor_restriction", { _id: id as string, _name: name, _phone: phone ?? "", _reason: reason, _active: active });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(id ? (active ? "Restored" : "Removed from list") : "Added to restricted list");
    if (!id) setForm({ name: "", phone: "", reason: "" });
    qc.invalidateQueries({ queryKey: ["restrictions"] });
  }
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl"><CardContent className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">Guards see a warning and can't let listed people in without a committee decision.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="r-name">Name *</Label><Input id="r-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label htmlFor="r-phone">Phone</Label><Input id="r-phone" className="h-11" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div><Label htmlFor="r-reason">Reason *</Label><Input id="r-reason" className="h-11" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={300} /></div>
        <Button className="h-11 rounded-xl" disabled={busy || form.name.trim().length < 2 || form.reason.trim().length < 5}
          onClick={() => save(null, form.name, form.phone || null, form.reason, true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </CardContent></Card>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : q.isError ? <p className="text-sm text-destructive">{gateErrorMessage(q.error)}</p> : !q.data?.length ? (
        <p className="text-sm text-muted-foreground text-center">Nobody on the list.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className={cn("rounded-2xl border p-3 flex items-center gap-3", !r.is_active && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{r.visitor_name}{r.phone ? ` · ••${r.phone.slice(-4)}` : ""}</p>
                <p className="text-xs text-muted-foreground truncate">{r.reason}</p>
              </div>
              <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => save(r.id, r.visitor_name, r.phone, r.reason, !r.is_active)}>
                {r.is_active ? "Remove" : "Restore"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface IncidentRow { id: string; kind: string; severity: string; note: string; status: string; created_at: string; resolution_note: string | null }
function IncidentList({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["incidents", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("security_incidents").select("id, kind, severity, note, status, created_at, resolution_note")
        .eq("society_id", societyId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as IncidentRow[];
    },
  });
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto" />;
  if (q.isError) return <p className="text-sm text-destructive">{gateErrorMessage(q.error)}</p>;
  return (
    <>
      {!q.data?.length ? <p className="text-sm text-muted-foreground text-center py-4">No incidents reported. Guards report them from the Gate screen.</p> : (
        <ul className="space-y-2">
          {q.data.map((i) => (
            <li key={i.id} className="rounded-2xl border p-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium capitalize">{i.kind}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", i.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{i.severity}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", i.status === "open" ? "bg-warning/15 text-warning-foreground" : "bg-success/15 text-success")}>{i.status === "open" ? "Open" : "Resolved"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{fmtTime(i.created_at)}</span>
              </div>
              <p className="text-sm">{i.note}</p>
              {i.resolution_note && <p className="text-xs text-muted-foreground">Resolution: {i.resolution_note}</p>}
              {i.status === "open" && <Button size="sm" variant="outline" className="min-h-11" onClick={() => setResolving(i.id)}>Resolve</Button>}
            </li>
          ))}
        </ul>
      )}
      <ReasonSheet title="Resolve incident" hint="Describe what was done." min={5}
        open={!!resolving} onOpenChange={(o) => !o && setResolving(null)}
        onSubmit={async (note) => {
          const { error } = await supabase.rpc("incident_resolve", { _id: resolving!, _note: note });
          if (error) { toast.error(gateErrorMessage(error)); return false; }
          toast.success("Incident resolved"); qc.invalidateQueries({ queryKey: ["incidents"] }); return true;
        }} />
    </>
  );
}
