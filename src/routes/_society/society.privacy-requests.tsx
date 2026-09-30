import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";
import { govRpc, govError, PRIVACY_KIND, PRIVACY_STATUS, fmtDateTime } from "@/lib/governance";

export const Route = createFileRoute("/_society/society/privacy-requests")({
  head: () => ({
    meta: [
      { title: "Privacy Requests — SociyoHub" },
      { name: "description", content: "Review residents' data export, correction and deletion requests with retention rules protected." },
      { property: "og:title", content: "Privacy Requests — SociyoHub" },
      { property: "og:description", content: "Review resident privacy requests safely." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrivacyRequestsAdmin,
});

type Req = { id: string; user_id: string; kind: string; details: string; status: string; outcome: string | null; retained: string[]; created_at: string; reviewed_at: string | null };

function PrivacyRequestsAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["admin-privacy-requests", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("privacy_requests").select("id,user_id,kind,details,status,outcome,retained,created_at,reviewed_at")
        .eq("society_id", societyId!).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Req[];
      const ids = [...new Set(rows.map((r) => r.user_id))];
      const names = ids.length ? await supabase.from("profiles").select("id,full_name").in("id", ids) : { data: [] as any[] };
      return { rows, names: new Map(((names.data ?? []) as any[]).map((p) => [p.id as string, (p.full_name as string) || "Resident"])) };
    },
  });
  const open = q.data?.rows.find((r) => r.id === openId) ?? null;

  async function review(status: string) {
    if (!open) return;
    setBusy(true);
    try {
      await govRpc("privacy_request_review", { _id: open.id, _status: status, _outcome: outcome });
      toast.success("Decision recorded — the resident is notified");
      setOpenId(null); setOutcome("");
      qc.invalidateQueries({ queryKey: ["admin-privacy-requests"] });
    } catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }

  const openRows = q.data?.rows.filter((r) => ["pending", "under_review"].includes(r.status)) ?? [];
  const doneRows = q.data?.rows.filter((r) => !["pending", "under_review"].includes(r.status)) ?? [];
  const row = (r: Req) => (
    <li key={r.id}>
      <button onClick={() => { setOpenId(r.id); setOutcome(r.outcome ?? ""); }} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{PRIVACY_KIND[r.kind]}</span><span className="block text-xs text-muted-foreground">{q.data?.names.get(r.user_id) ?? "Resident"} · {fmtDateTime(r.created_at)}</span></span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", PRIVACY_STATUS[r.status]?.className)}>{PRIVACY_STATUS[r.status]?.label}</span>
      </button>
    </li>
  );

  return (
    <PageShell>
      <PageHeader title="Privacy requests" description="Review requests. Financial, security and audit records are always kept by law." />
      {q.isLoading ? <ListSkeleton rows={3} />
        : q.isError ? <LoadError title="We couldn't load privacy requests." onRetry={() => q.refetch()} />
        : !q.data?.rows.length ? <ListEmpty icon={ShieldCheck} title="No privacy requests">Residents can ask for a copy, correction or deletion of their data from their app.</ListEmpty>
        : (
          <div className="space-y-5">
            {openRows.length > 0 && <section><h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs review</h2><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{openRows.map(row)}</ul></section>}
            {doneRows.length > 0 && <section><h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviewed</h2><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{doneRows.map(row)}</ul></section>}
          </div>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          {open && (
            <div className="mx-auto max-w-2xl space-y-4 pb-6">
              <SheetHeader><SheetTitle className="text-left">{PRIVACY_KIND[open.kind]} — {q.data?.names.get(open.user_id)}</SheetTitle></SheetHeader>
              {open.details && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{open.details}</p>}
              {open.kind === "deletion" && (
                <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">Nothing is deleted automatically. Remove only optional details (for example vehicles or family members) through their normal pages. Bills, payments, receipts, ledger entries, gate logs and audit history must be kept and will be listed as retained.</p>
              )}
              {open.kind === "export" && <p className="text-sm text-muted-foreground">Approving lets the resident download their own personal details (profile, homes, vehicles, family) for 30 days. It never includes other residents' data.</p>}
              {open.kind === "correction" && <p className="text-sm text-muted-foreground">Make the correction through the resident's normal record, then record what was changed.</p>}
              {["pending", "under_review"].includes(open.status) ? (
                <>
                  <div><Label htmlFor="pr-out">Decision note (shared with the resident)</Label><Textarea id="pr-out" rows={4} maxLength={3000} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></div>
                  <div className="flex flex-wrap gap-2">
                    {open.status === "pending" && <Button variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={() => review("under_review")}>Start review</Button>}
                    <Button className="min-h-11 rounded-xl" disabled={busy} onClick={() => review("completed")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : open.kind === "deletion" ? "Complete (keep required records)" : "Complete"}</Button>
                    <Button variant="ghost" className="min-h-11 rounded-xl text-destructive" disabled={busy} onClick={() => review("declined")}>Decline</Button>
                  </div>
                </>
              ) : (
                <div className="space-y-2 text-sm">
                  <p><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", PRIVACY_STATUS[open.status]?.className)}>{PRIVACY_STATUS[open.status]?.label}</span> {open.reviewed_at && fmtDateTime(open.reviewed_at)}</p>
                  {open.outcome && <p className="whitespace-pre-wrap">{open.outcome}</p>}
                  {open.retained?.length > 0 && <div><p className="font-medium">Kept by law</p><ul className="list-disc pl-5 text-muted-foreground">{open.retained.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
