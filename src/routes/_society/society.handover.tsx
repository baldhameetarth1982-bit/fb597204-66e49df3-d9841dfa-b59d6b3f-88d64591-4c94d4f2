import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, ClipboardCheck, Loader2 } from "lucide-react";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getHandoverSummary, setHandoverStatus, HANDOVER_STATUSES, type HandoverStatus } from "@/lib/handover.functions";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/handover")({
  head: () => ({ meta: [
    { title: "Society handover — SociyoHub" },
    { name: "description", content: "Track handover readiness: structure, flats, residents, imports, documents and finances." },
    { property: "og:title", content: "Society handover — SociyoHub" },
    { property: "og:description", content: "Handover checklist built from live society records." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: HandoverPage,
});

const LABEL: Record<HandoverStatus, string> = {
  not_started: "Not started", in_progress: "In progress", ready: "Ready for handover", handed_over: "Handed over",
};

function HandoverPage() {
  const { societyId } = useSocietyId();
  const load = useServerFn(getHandoverSummary);
  const save = useServerFn(setHandoverStatus);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["handover", societyId], enabled: !!societyId, queryFn: () => load({ data: { societyId: societyId! } }) });
  const [status, setStatus] = useState<HandoverStatus>("not_started");
  const [note, setNote] = useState("");
  useEffect(() => { if (q.data) { setStatus(q.data.status); setNote(q.data.note ?? ""); } }, [q.data]);
  const m = useMutation({
    mutationFn: () => save({ data: { societyId: societyId!, status, note: note.trim() || undefined } }),
    onSuccess: () => { toast.success(tu("op.handover_status_saved")); void qc.invalidateQueries({ queryKey: ["handover", societyId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const s = q.data;
  const items = s ? [
    { ok: s.blocks > 0, label: "Society structure", detail: `${s.blocks} blocks/wings`, to: "/society/flats" },
    { ok: s.flats > 0, label: "Flats / units", detail: `${s.flats} active units`, to: "/society/flats" },
    { ok: s.occupied_flats > 0, label: "Residents & occupancy", detail: `${s.occupied_flats} of ${s.flats} units occupied`, to: "/society/residents" },
    { ok: s.admins > 0, label: "Committee admins assigned", detail: `${s.admins} admins`, to: "/society/team" },
    { ok: s.open_imports === 0 && s.failed_imports === 0, label: "Imports resolved", detail: `${s.completed_imports} completed · ${s.open_imports} open · ${s.failed_imports} failed${s.import_conflict_rows ? ` · ${s.import_conflict_rows} rows need review` : ""}`, to: "/society/import" },
    { ok: s.opening_balance_set, label: "Opening cash & bank balances", detail: s.opening_balance_set ? "Set" : "Not set", to: "/society/accounts" },
    { ok: s.held_import_rows === 0, label: "Held import rows reviewed", detail: s.held_import_rows ? `${s.held_import_rows} rows kept aside for review` : "None held", to: "/society/import" },
    { ok: s.opening_balances_unverified === 0, label: "Imported past dues reviewed", detail: `${s.opening_balances_confirmed} confirmed · ${s.opening_balances_unverified} awaiting review`, to: "/society/opening-balances" },
    { ok: s.pending_bill_run_approvals === 0, label: "Bill runs awaiting approval", detail: s.pending_bill_run_approvals ? `${s.pending_bill_run_approvals} waiting` : "None", to: "/society/bill-studio/generate" },
    { ok: s.documents > 0, label: "Handover documents uploaded", detail: `${s.documents} documents`, to: "/society/knowledge" },
    { ok: s.setup_completed, label: "Setup wizard completed", detail: s.setup_completed ? "Done" : "Pending", to: "/society/dashboard" },
  ] : [];
  const done = items.filter((i) => i.ok).length;

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow={tu("setup.title")} title={tu("mod.handover")} subtitle={tu("op.readiness_from_live_records_uses")} icon={ClipboardCheck} variant="teal" />
    <div className="px-4 md:px-6 pt-4 space-y-4 max-w-3xl">
      {q.isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tu("common.loading")}</p>}
      {q.isError && <SectionCard icon={AlertCircle} title={tu("hd.unavailable")}><p className="text-sm text-destructive">{(q.error as Error).message}</p>
        <Button className="mt-3 min-h-11" variant="outline" onClick={() => q.refetch()}>{tu("common.retry")}</Button></SectionCard>}
      {s && <>
        <SectionCard title={tu("op.checklist")} description={`${done} of ${items.length} ready`} bodyClassName="p-0">
          <ul className="divide-y">{items.map((i) => <li key={i.label}>
            <Link to={i.to} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/40">
              {i.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0"><span className="block text-sm font-medium">{i.label}</span><span className="block text-xs text-muted-foreground break-words">{i.detail}</span></span>
            </Link></li>)}</ul>
        </SectionCard>
        <SectionCard title={tu("op.handover_status")} description={s.updated_at ? `Last changed ${new Date(s.updated_at).toLocaleString("en-IN")}` : tu("op.every_change_is_recorded_in")}>
          <div className="space-y-3">
            <div><Label htmlFor="ho-status">{tu("common.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as HandoverStatus)}>
                <SelectTrigger aria-label={tu("common.status")} id="ho-status" className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{HANDOVER_STATUSES.map((k) => <SelectItem key={k} value={k}>{LABEL[k]}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label htmlFor="ho-note">{tu("gp.note")} {status === "handed_over" && tu("op.required_3")}</Label>
              <Textarea id="ho-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tu("op.who_received_the_handover_when")} /></div>
            <Button className="min-h-11" disabled={m.isPending || !societyId} onClick={() => m.mutate()}>
              {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("op.save_status")}</Button>
          </div>
        </SectionCard>
      </>}
    </div>
  </div>;
}
