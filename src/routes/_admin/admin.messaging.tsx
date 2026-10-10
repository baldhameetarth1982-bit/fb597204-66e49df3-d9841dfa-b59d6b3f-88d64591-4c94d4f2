import { createFileRoute } from "@tanstack/react-router";
import { superAdminReason } from "@/lib/super-admin-reason";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getMessagingConnections, runMessagingDispatch } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_admin/admin/messaging")({
  head: () => ({ meta: [
    { title: "Messaging — Super Admin · SociyoHub" },
    { name: "description", content: "Email, SMS and WhatsApp provider status, delivery results and retries." },
    { property: "og:title", content: "Messaging — Super Admin · SociyoHub" },
    { property: "og:description", content: "Email, SMS and WhatsApp provider status, delivery results and retries." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MessagingPage,
});

const LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const STATUS_LABEL: Record<string, string> = { queued: "Waiting", sending: "Sending", sent: "Sent", failed: "Failed", not_connected: "Provider not connected", disabled: "Channel off", no_address: "No phone/email", unconfirmed: "Not confirmed (check before resending)" };
const ERR: Record<string, string> = { reason_required: "Please give a reason (at least 5 characters).", not_authorized: "Only Super Admins can do this.", rate_limited: "Too many resends. Try again in an hour." };
const msg = (e: unknown) => { const m = e instanceof Error ? e.message : ""; return Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? "Something went wrong. Please try again."; };

function MessagingPage() {
  const qc = useQueryClient();
  const conns = useServerFn(getMessagingConnections);
  const dispatch = useServerFn(runMessagingDispatch);
  const ov = useQuery({ queryKey: ["admin-messaging"], queryFn: async () => {
    const { data, error } = await (supabase.rpc as any)("admin_messaging_overview");
    if (error) throw error; return data as any;
  } });
  const cq = useQuery({ queryKey: ["admin-messaging-conn"], queryFn: () => conns() });
  const [reason, setReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-messaging"] });

  const setCh = useMutation({ networkMode: "always", retry: false,
    mutationFn: async (v: { channel: string; enabled: boolean }) => {
      const { error } = await (supabase.rpc as any)("admin_set_messaging_channel", { _channel: v.channel, _enabled: v.enabled, _reason: superAdminReason(reason) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Channel updated"); setReason(""); refresh(); }, onError: (e) => toast.error(msg(e)) });
  const retry = useMutation({ networkMode: "always", retry: false,
    mutationFn: async (channel: string) => {
      const { data, error } = await (supabase.rpc as any)("admin_retry_failed_messages", { _channel: channel, _reason: superAdminReason(reason) });
      if (error) throw error; return data as number;
    },
    onSuccess: (n) => { toast.success(`${n} message(s) queued again`); setReason(""); refresh(); }, onError: (e) => toast.error(msg(e)) });
  const resend = useMutation({ networkMode: "always", retry: false,
    mutationFn: async (channel: string) => {
      const { data, error } = await (supabase.rpc as any)("admin_resend_unconfirmed_messages", { _channel: channel, _reason: superAdminReason(reason) });
      if (error) throw error; return data as number;
    },
    onSuccess: (n) => { toast.success(`${n} unconfirmed message(s) queued again`); setReason(""); refresh(); }, onError: (e) => toast.error(msg(e)) });
  const run = useMutation({ networkMode: "always", retry: false, mutationFn: () => dispatch({ data: {} }),
    onSuccess: (s) => { toast.success(`Processed ${s.processed}: ${s.sent} sent, ${s.failed} failed, ${s.skipped} skipped`); refresh(); },
    onError: (e) => toast.error(msg(e)) });

  return (
    <PageShell>
      <PageHeader title="Messaging" description="In-app notifications always go out first. Email, SMS and WhatsApp are extra channels." />
      {ov.isError ? <p className="text-sm text-destructive">Couldn't load messaging. <button className="min-h-11 underline" onClick={() => ov.refetch()}>Try again</button></p>
      : !ov.data ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-4">
          <label className="block text-sm font-medium">Reason for any change
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Provider account approved" className="mt-1" />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            {(ov.data.channels ?? []).map((c: any) => {
              const connected = cq.data?.[c.channel as "email"];
              return (
                <section key={c.channel} className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{LABEL[c.channel]}</h2>
                    <Switch aria-label={`Turn ${LABEL[c.channel]} on or off`} checked={c.enabled} disabled={setCh.isPending}
                      onCheckedChange={(v) => setCh.mutate({ channel: c.channel, enabled: v })} />
                  </div>
                  <p className={`text-sm ${connected ? "text-success" : "text-warning"}`}>
                    {cq.isLoading ? "Checking provider…" : connected ? "Provider connected" : "Provider not connected"}
                  </p>
                  {c.last_health_at && <p className="text-xs text-muted-foreground">Last send {c.last_health_ok ? "worked" : `failed (${c.last_error ?? "error"})`} · {new Date(c.last_health_at).toLocaleString("en-IN")}</p>}
                  <ul className="text-sm space-y-1">
                    {Object.entries(c.counts ?? {}).length === 0 ? <li className="text-muted-foreground">No messages in the last 7 days</li>
                      : Object.entries(c.counts).map(([k, n]) => <li key={k} className="flex justify-between"><span>{STATUS_LABEL[k] ?? k}</span><span className="tabular-nums">{String(n)}</span></li>)}
                  </ul>
                  <Button variant="outline" className="min-h-11 w-full" disabled={retry.isPending} onClick={() => retry.mutate(c.channel)}>Retry failed (last 3 days)</Button>
                  {Number(c.counts?.unconfirmed ?? 0) > 0 && (
                    <Button variant="outline" className="min-h-11 w-full" disabled={resend.isPending}
                      onClick={() => { if (window.confirm("These messages may already have reached people. Resend anyway?")) resend.mutate(c.channel); }}>
                      Resend unconfirmed
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
          <Button className="min-h-11" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Sending…" : "Send waiting messages now"}</Button>
          <p className="text-xs text-muted-foreground">Credentials are set on the server only (Resend for email, Twilio for SMS/WhatsApp). Without them, messages are marked "Provider not connected" and people still get the in-app notification. Emergency broadcasts are queued here automatically. Waiting messages send right away when queued; failed ones retry with growing gaps, checked every hour. If a send is interrupted, it is never resent blindly: email reuses the same delivery key so the provider drops duplicates, SMS/WhatsApp are checked with the provider first, and anything that can't be confirmed is marked "Not confirmed" for you to decide.</p>
        </div>
      )}
    </PageShell>
  );
}
