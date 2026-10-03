import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Siren, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InlineNotice, ListEmpty, ListSkeleton, LoadError, StatusChip } from "@/components/people/PeopleUI";
import { communityError } from "@/lib/community-errors";

export const Route = createFileRoute("/_society/society/emergency")({
  head: () => ({
    meta: [
      { title: "Emergency broadcast — SociyoHub" },
      { name: "description", content: "Send urgent society-wide alerts, track who has seen them, and keep a full history." },
      { property: "og:title", content: "Emergency broadcast — SociyoHub" },
      { property: "og:description", content: "Authorised committee alerts, separate from notices and SOS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmergencyAdmin,
});

const AUDIENCE: Record<string, string> = { everyone: "Everyone (residents, committee, guards, staff)", residents: "All residents", gate_staff: "Guards & staff", committee: "Committee only", block: "Residents of one block" };
const EXPIRY = [{ v: "60", l: "1 hour" }, { v: "240", l: "4 hours" }, { v: "720", l: "12 hours" }, { v: "1440", l: "24 hours" }, { v: "4320", l: "3 days" }];
const CHANNEL_LABEL: Record<string, string> = { sent: "Sent", partial: "Partly sent", no_recipients: "No recipients", best_effort: "Phone alerts where enabled", not_configured: "Not connected" };

function EmergencyAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [composing, setComposing] = useState<{ sos?: string } | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [reason, setReason] = useState("");

  const list = useQuery({
    enabled: !!societyId,
    queryKey: ["emergency-broadcasts-admin", societyId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("emergency_broadcasts").select("*").eq("society_id", societyId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      const ids = (data ?? []).map((b: any) => b.id);
      const acks = new Map<string, number>();
      if (ids.length) {
        const { data: r } = await sb.from("emergency_broadcast_recipients").select("broadcast_id").in("broadcast_id", ids).not("acknowledged_at", "is", null);
        for (const x of r ?? []) acks.set(x.broadcast_id, (acks.get(x.broadcast_id) ?? 0) + 1);
      }
      return (data ?? []).map((b: any) => ({ ...b, acks: acks.get(b.id) ?? 0 }));
    },
  });
  const sos = useQuery({
    enabled: !!societyId,
    queryKey: ["emergency-recent-sos", societyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("sos_alerts").select("id,status,note,created_at").eq("society_id", societyId).gte("created_at", new Date(Date.now() - 2 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(5);
      return (data ?? []) as { id: string; status: string; note: string | null; created_at: string }[];
    },
  });
  const cancel = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => { const { error } = await (supabase as any).rpc("emergency_broadcast_cancel", { _id: cancelling.id, _reason: reason.trim() }); if (error) throw error; },
    onSuccess: () => { toast.success("Broadcast cancelled"); setCancelling(null); setReason(""); qc.invalidateQueries({ queryKey: ["emergency-broadcasts-admin"] }); },
    onError: (e) => toast.error(communityError(e)),
  });

  return (
    <PageShell>
      <PageHeader title="Emergency broadcast" description="For urgent safety messages only. Separate from notices and from resident SOS."
        actions={<Button variant="destructive" className="min-h-11" onClick={() => setComposing({})}><Siren className="mr-2 h-4 w-4" />New broadcast</Button>} />
      <InlineNotice icon={Siren} title="How delivery works">
        Recipients get an urgent in-app alert pinned on top of their app, plus a phone notification if they've enabled one. SMS, WhatsApp and email are not connected yet, so nothing is sent through them.
      </InlineNotice>
      {(sos.data ?? []).length > 0 && (
        <section className="mt-4 space-y-2">
          <h2 className="text-sm font-semibold">Recent SOS alerts</h2>
          <p className="text-xs text-muted-foreground">SOS alerts are never broadcast automatically. You can choose to issue a broadcast about one.</p>
          {sos.data!.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm">
              <span className="min-w-0 truncate">{new Date(s.created_at).toLocaleString("en-IN")} · {s.status}{s.note ? ` · ${s.note}` : ""}</span>
              <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setComposing({ sos: s.id })}>Broadcast about this</Button>
            </div>
          ))}
        </section>
      )}
      <section className="mt-6 space-y-3">
        <h2 className="font-semibold">History</h2>
        {list.isLoading ? <ListSkeleton rows={3} /> : list.isError ? <LoadError title="Couldn't load broadcasts" onRetry={() => void list.refetch()} /> : !(list.data ?? []).length ? (
          <ListEmpty icon={Siren} title="No broadcasts yet">Broadcasts you send will be listed here with delivery and seen counts.</ListEmpty>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {list.data!.map((b: any) => {
              const state = b.cancelled_at ? "Cancelled" : new Date(b.expires_at) <= new Date() ? "Expired" : "Active";
              return (
                <li key={b.id} className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip tone={state === "Active" ? "warning" : "muted"}>{state}</StatusChip>
                    <StatusChip tone="info">{b.category_label}</StatusChip>
                    <StatusChip tone="muted">{AUDIENCE[b.audience]?.split(" (")[0]}</StatusChip>
                  </div>
                  <p className="font-medium break-words">{b.title}</p>
                  <p className="whitespace-pre-line text-sm text-muted-foreground break-words">{b.message}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {new Date(b.created_at).toLocaleString("en-IN")} · {b.recipient_count} recipients · {b.in_app_delivered} in-app alerts · {b.acks} seen
                  </p>
                  <p className="text-xs text-muted-foreground">
                    In-app: {CHANNEL_LABEL[b.channel_status?.in_app] ?? b.channel_status?.in_app} · SMS/WhatsApp/Email: {CHANNEL_LABEL.not_configured}
                  </p>
                  {b.cancel_reason && <p className="text-xs">Cancel reason: {b.cancel_reason}</p>}
                  {state === "Active" && <Button size="sm" variant="outline" className="min-h-11" onClick={() => setCancelling(b)}><XCircle className="mr-1 h-4 w-4" />Cancel broadcast</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <EmergencyCategories />
      {composing && <Compose sosId={composing.sos} societyId={societyId!} onClose={() => setComposing(null)} />}
      {cancelling && (
        <Dialog open onOpenChange={(o) => !o && setCancelling(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancel broadcast</DialogTitle><DialogDescription>It stops showing as active. The record stays in history.</DialogDescription></DialogHeader>
            <Label htmlFor="cr">Reason</Label>
            <Textarea id="cr" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" className="min-h-11" onClick={() => setCancelling(null)}>Back</Button>
              <Button className="min-h-11" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>Cancel broadcast</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}

function useEmergencyCategories() {
  return useQuery({
    queryKey: ["emergency-categories"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("emergency_categories").select("id,label,active,society_id").order("sort_order");
      if (error) throw error;
      return data as { id: string; label: string; active: boolean; society_id: string | null }[];
    },
  });
}

function Compose({ sosId, societyId, onClose }: { sosId?: string; societyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useEmergencyCategories();
  const blocks = useQuery({
    queryKey: ["blocks-lite", societyId],
    queryFn: async () => { const { data } = await (supabase as any).from("blocks").select("id,name").eq("society_id", societyId).order("name"); return (data ?? []) as { id: string; name: string }[]; },
  });
  const requestId = useMemo(() => crypto.randomUUID(), []);
  const [f, setF] = useState({ category: "", title: "", message: "", audience: "everyone", block: "", expires: "240" });
  const [confirm, setConfirm] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const invalid = !f.category || f.title.trim().length < 3 || f.message.trim().length < 3 || /[<>{}]/.test(f.title + f.message) || (f.audience === "block" && !f.block);
  const send = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("emergency_broadcast_send", {
        _category_id: f.category, _title: f.title.trim(), _message: f.message.trim(), _audience: f.audience,
        _block_id: f.audience === "block" ? f.block : null, _expires_minutes: Number(f.expires), _sos_alert_id: sosId ?? null, _request_id: requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Emergency broadcast sent"); qc.invalidateQueries({ queryKey: ["emergency-broadcasts-admin"] }); onClose(); },
    onError: (e) => { setConfirm(false); toast.error(communityError(e)); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>New emergency broadcast</DialogTitle><DialogDescription>Goes out immediately as an urgent alert.{sosId ? " Linked to the selected SOS alert." : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Type</Label>
            <Select value={f.category} onValueChange={(v) => set("category", v)}><SelectTrigger className="min-h-11"><SelectValue placeholder="Choose type" /></SelectTrigger>
              <SelectContent>{(cats.data ?? []).filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor="et">Headline</Label><Input id="et" className="min-h-11" maxLength={100} value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="em">Message</Label><Textarea id="em" rows={4} maxLength={1000} value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="What is happening and what should people do?" /></div>
          <div className="space-y-1"><Label>Who gets it</Label>
            <Select value={f.audience} onValueChange={(v) => set("audience", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(AUDIENCE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          {f.audience === "block" && <div className="space-y-1"><Label>Block</Label>
            <Select value={f.block} onValueChange={(v) => set("block", v)}><SelectTrigger className="min-h-11"><SelectValue placeholder="Choose block" /></SelectTrigger>
              <SelectContent>{(blocks.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>}
          <div className="space-y-1"><Label>Show as active for</Label>
            <Select value={f.expires} onValueChange={(v) => set("expires", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{EXPIRY.map((x) => <SelectItem key={x.v} value={x.v}>{x.l}</SelectItem>)}</SelectContent></Select></div>
          {/[<>{}]/.test(f.title + f.message) && <p className="text-xs text-destructive">Remove &lt; &gt; {"{"} {"}"} characters.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          {!confirm
            ? <Button variant="destructive" className="min-h-11" disabled={invalid} onClick={() => setConfirm(true)}>Review & send</Button>
            : <Button variant="destructive" className="min-h-11" disabled={send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Confirm — send now"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmergencyCategories() {
  const qc = useQueryClient();
  const cats = useEmergencyCategories();
  const [label, setLabel] = useState("");
  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string | null; label: string; active: boolean | null }) => {
      const { error } = await (supabase as any).rpc("emergency_set_category", { _id: v.id, _label: v.label, _active: v.active }); if (error) throw error;
    },
    onSuccess: () => { setLabel(""); qc.invalidateQueries({ queryKey: ["emergency-categories"] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-semibold">Emergency types</h2>
      <div className="flex flex-wrap gap-2">
        {(cats.data ?? []).map((c) => (
          <span key={c.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
            {c.label}{!c.active && " (hidden)"}
            {c.society_id && <button type="button" className="min-h-8 text-xs text-primary underline" onClick={() => save.mutate({ id: c.id, label: c.label, active: !c.active })}>{c.active ? "Hide" : "Show"}</button>}
          </span>
        ))}
      </div>
      <div className="flex max-w-md gap-2">
        <Input aria-label="New emergency type" className="min-h-11" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Gas leak" />
        <Button className="min-h-11" disabled={label.trim().length < 2 || /[<>{}]/.test(label) || save.isPending} onClick={() => save.mutate({ id: null, label: label.trim(), active: true })}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
    </section>
  );
}
