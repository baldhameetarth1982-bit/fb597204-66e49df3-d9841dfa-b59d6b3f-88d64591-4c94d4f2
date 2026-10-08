/**
 * P09/P10 society-side screens: flat entitlement, custom plan request,
 * conversation and offer review. All writes go through SECURITY DEFINER RPCs
 * (request_custom_plan / custom_plan_post_message / respond_custom_offer) which
 * re-check permission, society and state server-side. Reads use RLS.
 * Checkout reuses the canonical subscription engine (/checkout/$planId).
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, MessageSquare, Send, FileText, Check, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SettingsSection } from "@/components/settings/SettingsUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";
import { userMessage } from "@/lib/user-error";

const db = supabase as any;
export const inr = (paise: number | null | undefined) =>
  paise == null ? "—" : `₹${(Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export type Entitlement = {
  pricing_type: string; purchased: number | null; current: number; available: number | null;
  state: "recorded" | "unrecorded"; rate_per_flat_inr: number | null; renews_at: string | null; plan_status: string | null;
};

export function FlatEntitlementSection({ societyId }: { societyId: string }) {
  const q = useQuery({
    queryKey: ["flat-entitlement", societyId],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_society_flat_entitlement", { _society_id: societyId });
      if (error) throw error;
      return data as Entitlement;
    },
  });
  return (
    <SettingsSection title="Flats on your plan" icon={Building2}>
      {q.isLoading ? <Skeleton className="h-16 w-full" />
        : q.isError ? <ErrorState title="Couldn't load your flat limit" description="Please try again." onRetry={() => q.refetch()} />
        : (
          <div className="space-y-2">
            <dl className="grid grid-cols-3 gap-2">
              {[["Purchased", q.data!.purchased ?? "—"], ["Current", q.data!.current], ["Available", q.data!.available ?? "—"]].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl border p-3">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {q.data!.pricing_type === "custom" && q.data!.rate_per_flat_inr != null && (
              <p className="text-sm text-muted-foreground">Custom plan · ₹{Number(q.data!.rate_per_flat_inr)} per flat per month</p>
            )}
            {q.data!.state === "unrecorded" && (
              <p className="text-sm text-muted-foreground">No purchased flat quantity is recorded yet. It is set when a subscription payment is confirmed.</p>
            )}
            {q.data!.available === 0 && (
              <p role="status" className="text-sm font-medium">You've reached your purchased flats. Renew with more flats to add new ones.</p>
            )}
          </div>
        )}
    </SettingsSection>
  );
}

type Req = { id: string; flat_quantity: number; plan_id: string | null; status: string; created_at: string };
type Msg = { id: string; sender_side: string; body: string; created_at: string };
export type Offer = {
  id: string; request_id: string; plan_id: string; rate_per_flat_inr: number; flat_quantity: number; term_months: number;
  effective_from: string; base_amount_paise: number; tax_percent: number; tax_amount_paise: number; total_amount_paise: number;
  status: string; created_at: string;
};

export function useCustomPlanThread(requestId: string | null) {
  const msgs = useQuery({
    enabled: !!requestId,
    queryKey: ["custom-plan-messages", requestId],
    queryFn: async () => {
      const { data, error } = await db.from("custom_plan_messages")
        .select("id,sender_side,body,created_at").eq("request_id", requestId).order("created_at").limit(300);
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
    refetchInterval: 20_000,
  });
  const offers = useQuery({
    enabled: !!requestId,
    queryKey: ["custom-plan-offers", requestId],
    queryFn: async () => {
      const { data, error } = await db.from("custom_plan_offers").select("*").eq("request_id", requestId)
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as Offer[];
    },
  });
  return { msgs, offers };
}

export function Conversation({ requestId, mySide, closed }: { requestId: string; mySide: "society" | "platform"; closed?: boolean }) {
  const qc = useQueryClient();
  const { msgs } = useCustomPlanThread(requestId);
  const [body, setBody] = useState("");
  const send = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (text: string) => {
      const { error } = await db.rpc("custom_plan_post_message", { _request_id: requestId, _body: text });
      if (error) throw error;
    },
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["custom-plan-messages", requestId] }); },
    onError: (e) => toast.error(userMessage(e, "Message not sent. Your text is still here — try again.")),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-4 w-4 text-primary" aria-hidden /> Conversation</div>
      {msgs.isLoading ? <Skeleton className="h-20 w-full" />
        : msgs.isError ? <ErrorState title="Couldn't load messages" description="Please try again." onRetry={() => msgs.refetch()} />
        : (
          <ol className="max-h-80 space-y-2 overflow-y-auto rounded-xl border p-3" aria-live="polite">
            {(msgs.data ?? []).map((m) => (
              <li key={m.id} className={m.sender_side === "system" ? "text-center text-xs text-muted-foreground"
                : `max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.sender_side === mySide ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.sender_side !== "system" && (
                  <span className="block text-[11px] opacity-80">{m.sender_side === "platform" ? "SociyoHub team" : "Society admin"} · {when(m.created_at)}</span>
                )}
                <span className="whitespace-pre-wrap break-words">{m.body}</span>
              </li>
            ))}
          </ol>
        )}
      {!closed && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = body.trim(); if (t && !send.isPending) send.mutate(t); }}>
          <Label htmlFor={`msg-${requestId}`} className="sr-only">Message</Label>
          <Textarea id={`msg-${requestId}`} value={body} maxLength={2000} rows={2} onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message" className="min-h-11" />
          <Button type="submit" disabled={send.isPending || !body.trim()} className="h-11 rounded-xl self-end" aria-label="Send message">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      )}
    </div>
  );
}

export function OfferCard({ offer, children }: { offer: Offer; children?: React.ReactNode }) {
  const rows: [string, string][] = [
    ["Plan", `Custom (${offer.plan_id === "premium" ? "Pro" : offer.plan_id === "pro" ? "Growth" : "Starter"} features)`],
    ["Purchased flats", String(offer.flat_quantity)],
    ["Rate", `₹${Number(offer.rate_per_flat_inr)} per flat per month`],
    ["Billing cycle", "Monthly rate, paid per term"],
    ["Term", `${offer.term_months} month(s) from ${new Date(offer.effective_from).toLocaleDateString("en-IN")}`],
    ["Base amount", inr(offer.base_amount_paise)],
    ["Taxes", Number(offer.tax_percent) > 0 ? `${inr(offer.tax_amount_paise)} (${Number(offer.tax_percent)}%)` : "None configured"],
    ["Final payable", inr(offer.total_amount_paise)],
  ];
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" aria-hidden /> Custom offer</span>
        <Badge variant="outline" className="capitalize">{offer.status}</Badge>
      </div>
      <dl className="grid gap-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Created {when(offer.created_at)}. No platform fee.</p>
      {children}
    </div>
  );
}

export function CustomPlanSection({ societyId, threshold, focusRequestId }: { societyId: string; threshold: number; focusRequestId?: string }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const reqs = useQuery({
    queryKey: ["custom-plan-requests", societyId],
    queryFn: async () => {
      const { data, error } = await db.from("custom_plan_requests").select("id,flat_quantity,plan_id,status,created_at")
        .eq("society_id", societyId).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });
  const live = (reqs.data ?? []).find((r) => ["open", "offered", "accepted", "active"].includes(r.status)) ?? null;
  const { offers } = useCustomPlanThread(live?.id ?? null);
  const current = (offers.data ?? []).find((o) => ["offered", "accepted", "active"].includes(o.status)) ?? null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["custom-plan-requests", societyId] });
    qc.invalidateQueries({ queryKey: ["custom-plan-offers"] });
    qc.invalidateQueries({ queryKey: ["custom-plan-messages"] });
    qc.invalidateQueries({ queryKey: ["subscription-quotes"] });
  };

  const request = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const n = Number(qty);
      if (!Number.isInteger(n) || n <= threshold || n > 100000) throw new Error(`Enter a whole number of flats above ${threshold}.`);
      const { data, error } = await db.rpc("request_custom_plan", { _society_id: societyId, _flat_quantity: n, _plan_id: null, _message: note.trim() || null });
      if (error) throw error;
      return data as { status: string };
    },
    onSuccess: (d) => { toast.success(d?.status === "existing" ? "You already have a custom plan request open." : "Request received. Our team will contact you soon."); refresh(); },
    onError: (e) => toast.error(userMessage(e, "Couldn't send your request. Please try again.")),
  });
  const respond = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await db.rpc("respond_custom_offer", { _offer_id: id, _accept: accept });
      if (error) throw error;
      return accept;
    },
    onSuccess: (accept) => { toast.success(accept ? "Offer accepted. Continue to secure checkout." : "Offer declined."); refresh(); },
    onError: (e) => toast.error(userMessage(e, "Couldn't update the offer. Please try again.")),
  });

  const linkUnavailable = !!focusRequestId && reqs.isSuccess && !(reqs.data ?? []).some((r) => r.id === focusRequestId);
  return (
    <div id="custom-plan" className="scroll-mt-20">
    {linkUnavailable && <p role="status" className="mb-2 text-sm text-muted-foreground">That custom plan conversation isn't available. Showing your society's current request instead.</p>}
    <SettingsSection title="Custom plan (more than 300 flats)" icon={Building2}
      description="Tell us how many flats you need. Our team will contact you with an offer.">
      {reqs.isLoading ? <Skeleton className="h-20 w-full" />
        : reqs.isError ? <ErrorState title="Couldn't load your custom plan" description="Please try again." onRetry={() => reqs.refetch()} />
        : !live ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!request.isPending) request.mutate(); }}>
            <div className="space-y-1">
              <Label htmlFor="cp-qty">Number of flats</Label>
              <Input id="cp-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
                placeholder={`e.g. ${threshold + 150}`} className="h-11 max-w-48" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cp-note">Message (optional)</Label>
              <Textarea id="cp-note" value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">Custom pricing — no price is shown until our team sends you an offer.</p>
            <Button type="submit" disabled={request.isPending || !qty} className="h-11 rounded-xl">
              {request.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Request custom plan
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <span><span className="font-semibold">Request received</span> · {live.flat_quantity} flats</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{live.status}</Badge>
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
              </span>
            </div>
            {live.status === "open" && !current && <p className="text-sm text-muted-foreground">Our team will contact you soon.</p>}
            {offers.isError ? <ErrorState title="Couldn't load the offer" description="Please try again." onRetry={() => offers.refetch()} />
              : current && (
                <OfferCard offer={current}>
                  {current.status === "offered" && (
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-11 rounded-xl" disabled={respond.isPending}
                        onClick={() => { if (window.confirm(`Accept ${current.flat_quantity} flats at ₹${Number(current.rate_per_flat_inr)}/flat/month, total ${inr(current.total_amount_paise)}?`)) respond.mutate({ id: current.id, accept: true }); }}>
                        <Check className="h-4 w-4 mr-2" /> Accept
                      </Button>
                      <Button variant="outline" className="h-11 rounded-xl" disabled={respond.isPending}
                        onClick={() => respond.mutate({ id: current.id, accept: false })}>
                        <X className="h-4 w-4 mr-2" /> Decline
                      </Button>
                    </div>
                  )}
                  {(current.status === "accepted" || current.status === "active") && (
                    <Button asChild className="h-11 rounded-xl">
                      <Link to="/checkout/$planId" params={{ planId: current.plan_id }}>
                        {current.status === "active" ? "Renew custom plan" : "Continue to checkout"}
                      </Link>
                    </Button>
                  )}
                </OfferCard>
              )}
            <Conversation requestId={live.id} mySide="society" />
          </div>
        )}
    </SettingsSection>
  );
}
