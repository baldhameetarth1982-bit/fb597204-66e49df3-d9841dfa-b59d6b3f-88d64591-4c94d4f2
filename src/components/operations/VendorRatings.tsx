// Vendor ratings: every write is an RPC tied to a real request/service visit (server resolves vendor, society, rater).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { opsErrorMessage } from "./OperationsTabs";
import { tu } from "@/lib/i18n";

export interface VendorPerf { vendor_id: string; rating_count: number; avg_rating: number | null; recent_count: number; recent_avg: number | null; tickets_total: number; tickets_open: number; tickets_overdue: number; service_visits: number; last_service: string | null }

export function ratingErrorMessage(e: unknown) {
  const m = String((e as { message?: string })?.message ?? "");
  if (m.includes("already_rated")) return "This has already been rated.";
  if (m.includes("no_vendor")) return "No service provider was linked to this.";
  if (m.includes("invalid_transition")) return "You can rate once the request is resolved.";
  return opsErrorMessage(e);
}

export function StarPicker({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(n)} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted">
          <Star className={`h-6 w-6 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}`} />
        </button>
      ))}
    </div>
  );
}

export function useVendorPerformance(sid: string | null) {
  return useQuery({
    queryKey: ["ops", "vendor-perf", sid], enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vendor_performance");
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as VendorPerf[]).map((p) => [p.vendor_id, p])) as Record<string, VendorPerf>;
    },
  });
}

export function perfLabel(p?: VendorPerf) {
  if (!p || !p.rating_count) return "No ratings yet";
  if (p.avg_rating == null) return `${p.rating_count} rating${p.rating_count === 1 ? "" : "s"} — too few for a score`;
  return `★ ${p.avg_rating}/5 from ${p.rating_count}`;
}

/** Committee view inside the vendor sheet: performance, history, moderation, rate a logged service visit. */
export function VendorPerformancePanel({ vendorId, perf }: { vendorId: string; perf?: VendorPerf }) {
  const qc = useQueryClient();
  const [log, setLog] = useState("");
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [hideReason, setHideReason] = useState<Record<string, string>>({});
  const hist = useQuery({
    queryKey: ["ops", "vendor-ratings", vendorId],
    queryFn: async () => {
      const [h, u] = await Promise.all([supabase.rpc("vendor_rating_history", { _vendor: vendorId }), supabase.rpc("vendor_service_log_unrated", { _vendor: vendorId })]);
      if (h.error || u.error) throw h.error ?? u.error;
      return { history: h.data ?? [], unrated: u.data ?? [] };
    },
  });
  const done = () => { qc.invalidateQueries({ queryKey: ["ops", "vendor-ratings", vendorId] }); qc.invalidateQueries({ queryKey: ["ops", "vendor-perf"] }); };
  const rate = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("admin_rate_vendor_service", { _log: log, _rating: stars, _comment: comment }); if (error) throw error; },
    onSuccess: () => { toast.success(tu("op.rating_saved")); setLog(""); setStars(0); setComment(""); done(); },
    onError: (e) => toast.error(ratingErrorMessage(e)),
  });
  const moderate = useMutation({
    mutationFn: async (v: { id: string; hide: boolean }) => { const { error } = await supabase.rpc("admin_moderate_vendor_rating", { _id: v.id, _hide: v.hide, _reason: hideReason[v.id] ?? "" }); if (error) throw error; },
    onSuccess: (_d, v) => { toast.success(v.hide ? "Rating hidden" : "Rating restored"); done(); },
    onError: (e) => toast.error(ratingErrorMessage(e)),
  });

  return (
    <section className="space-y-3 border-t pt-4" aria-label={tu("op.performance")}>
      <h3 className="text-sm font-semibold">{tu("op.performance")}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <p className="rounded-xl bg-muted/60 p-2">{perfLabel(perf)}</p>
        <p className="rounded-xl bg-muted/60 p-2">{tu("op.last_90_days")} {perf?.recent_avg != null ? `★ ${perf.recent_avg}` : `${perf?.recent_count ?? 0} rating${perf?.recent_count === 1 ? "" : "s"}`}</p>
        <p className="rounded-xl bg-muted/60 p-2">{perf?.tickets_total ?? 0} {tu("op.requests")} {perf?.tickets_open ?? 0} {tu("op.open")}{perf?.tickets_overdue ? ` · ${perf.tickets_overdue} overdue` : ""}</p>
        <p className="rounded-xl bg-muted/60 p-2">{perf?.service_visits ?? 0} {tu("op.service_visits")}{perf?.last_service ? ` · last ${perf.last_service}` : ""}</p>
      </div>
      {hist.isPending ? <p className="text-sm text-muted-foreground">{tu("op.loading_ratings")}</p> : hist.isError ? <p className="text-sm text-destructive">{opsErrorMessage(hist.error)}</p> : (
        <>
          {hist.data.unrated.length > 0 && (
            <div className="space-y-2 rounded-2xl border p-3">
              <p className="text-sm font-medium">{tu("op.rate_a_service_visit")}</p>
              <select aria-label={tu("op.service_visit")} className="h-11 w-full rounded-xl border bg-background px-3 text-sm" value={log} onChange={(e) => setLog(e.target.value)}>
                <option value="">{tu("op.choose_a_visit")}</option>
                {hist.data.unrated.map((u) => <option key={u.id} value={u.id}>{u.service_date} · {u.asset_name} · {u.kind}</option>)}
              </select>
              <StarPicker value={stars} onChange={setStars} label={tu("op.visit_rating")} />
              <Textarea rows={2} maxLength={500} className="rounded-xl" placeholder={tu("op.optional_notes")} aria-label={tu("op.visit_rating_notes")} value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="button" className="min-h-11 rounded-xl" disabled={!log || !stars || rate.isPending} onClick={() => rate.mutate()}>{tu("op.save_rating")}</Button>
            </div>
          )}
          {!hist.data.history.length ? <p className="text-sm text-muted-foreground">{tu("op.no_ratings_yet_residents_can")}</p> : (
            <ul className="divide-y rounded-2xl border">
              {hist.data.history.map((h) => (
                <li key={h.id} className="space-y-1 p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-medium">★ {h.rating}/5</span>
                    <span className="text-xs text-muted-foreground">{h.rater_label} · {h.source === "request" ? `Request #${h.ticket_no}` : `${h.asset_name ?? "Asset"} ${h.service_kind ?? ""}`} · {h.created_at.slice(0, 10)}</span>
                    {h.status === "hidden" && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{tu("op.hidden_3")} {h.moderation_reason}</span>}
                  </p>
                  {h.comment && <p className="whitespace-pre-wrap break-words text-muted-foreground">{h.comment}</p>}
                  <div className="flex gap-2">
                    <Input className="h-11 flex-1" maxLength={300} placeholder={h.status === "hidden" ? tu("op.reason_to_restore") : tu("op.reason_to_hide")} aria-label={tu("op.moderation_reason")}
                      value={hideReason[h.id] ?? ""} onChange={(e) => setHideReason({ ...hideReason, [h.id]: e.target.value })} />
                    <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={(hideReason[h.id] ?? "").trim().length < 3 || moderate.isPending}
                      onClick={() => moderate.mutate({ id: h.id, hide: h.status !== "hidden" })}>{h.status === "hidden" ? tu("op.restore") : tu("op.hide")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">{tu("op.hidden_ratings_are_kept_and")}</p>
    </section>
  );
}

/** Resident: rate the service provider on their own resolved request. */
export function ResidentVendorRating({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const st = useQuery({
    queryKey: ["helpdesk", "vendor-rating", ticketId],
    queryFn: async () => { const { data, error } = await supabase.rpc("vendor_rating_status", { _ticket: ticketId }); if (error) throw error; return data?.[0] ?? null; },
  });
  const rate = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("vendor_rate_ticket", { _ticket: ticketId, _rating: stars, _comment: comment }); if (error) throw error; },
    onSuccess: () => { toast.success(tu("op.thanks_your_rating_was_saved")); qc.invalidateQueries({ queryKey: ["helpdesk", "vendor-rating", ticketId] }); },
    onError: (e) => toast.error(ratingErrorMessage(e)),
  });
  if (!st.data?.eligible) return null;
  return (
    <div className="space-y-2 rounded-2xl border p-3">
      <p className="text-sm font-medium">{tu("op.rate_the_service_provider")}{st.data.vendor_name ? ` (${st.data.vendor_name})` : ""}</p>
      {st.data.rated ? <p className="text-sm text-muted-foreground">{tu("op.you_rated_them")} {st.data.my_rating}/5.</p> : (
        <>
          <StarPicker value={stars} onChange={setStars} label={tu("op.service_provider_rating")} />
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} className="rounded-xl" placeholder={tu("op.optional_comment_only_the_committee")} aria-label={tu("op.service_provider_comment")} />
          <Button className="min-h-11 rounded-xl" disabled={!stars || rate.isPending} onClick={() => rate.mutate()}>{tu("hd.submitRating")}</Button>
        </>
      )}
    </div>
  );
}
