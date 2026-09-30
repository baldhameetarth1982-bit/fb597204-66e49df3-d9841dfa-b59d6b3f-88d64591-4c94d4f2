import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListSkeleton, LoadError } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { govRpc, govError, PRIVACY_KIND, PRIVACY_STATUS, fmtDateTime } from "@/lib/governance";

export const Route = createFileRoute("/_resident/app/privacy-requests")({
  head: () => ({
    meta: [
      { title: "My Privacy Requests — SociyoHub" },
      { name: "description", content: "Ask your society for a copy of your data, a correction, or deletion where allowed." },
      { property: "og:title", content: "My Privacy Requests — SociyoHub" },
      { property: "og:description", content: "Request a copy, correction or deletion of your personal data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyPrivacyRequests,
});

type Req = { id: string; kind: string; details: string; status: string; outcome: string | null; retained: string[]; created_at: string; reviewed_at: string | null };

function MyPrivacyRequests() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState("export");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["my-privacy-requests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("privacy_requests").select("id,kind,details,status,outcome,retained,created_at,reviewed_at")
        .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Req[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-privacy-requests"] });

  async function submit() {
    setBusy("new");
    try { await govRpc("privacy_request_create", { _kind: kind, _details: details }); toast.success("Request sent to your committee"); setDetails(""); refresh(); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(null); }
  }
  async function withdraw(id: string) {
    setBusy(id);
    try { await govRpc("privacy_request_withdraw", { _id: id }); toast.success("Request withdrawn"); refresh(); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(null); }
  }
  async function download() {
    setBusy("dl");
    try {
      const data = await govRpc("privacy_personal_export", {});
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "my-sociyohub-data.json"; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(govError(e)); } finally { setBusy(null); }
  }

  const canDownload = q.data?.some((r) => r.kind === "export" && ["completed", "partially_completed"].includes(r.status) && r.reviewed_at && Date.now() - new Date(r.reviewed_at).getTime() < 30 * 864e5);

  return (
    <CommPage>
      <CommHeader title="Privacy requests" subtitle="Ask about the personal data your society holds" />
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <div role="radiogroup" aria-label="Request type" className="grid gap-2 sm:grid-cols-3">
          {Object.entries(PRIVACY_KIND).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium", kind === k ? "border-primary bg-primary/10" : "border-border")}>{l}</button>
          ))}
        </div>
        {kind === "deletion" && <p className="text-xs text-muted-foreground">Bills, payments, receipts, accounts, gate/security logs and audit history must be kept by law and won't be deleted. The committee will tell you what was removed and what was kept.</p>}
        <div><Label htmlFor="pr-details">{kind === "correction" ? "What should be corrected? *" : "Anything to add (optional)"}</Label>
          <Textarea id="pr-details" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <Button className="h-12 w-full rounded-xl" disabled={!!busy} onClick={submit}>{busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send request"}</Button>
      </section>

      {canDownload && (
        <Button variant="outline" className="mt-4 h-12 w-full rounded-xl" disabled={!!busy} onClick={download}>
          {busy === "dl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4 mr-2" />Download my data</>}
        </Button>
      )}

      <SectionLabel>My requests</SectionLabel>
      {q.isLoading ? <ListSkeleton rows={2} />
        : q.isError ? <LoadError title="We couldn't load your requests." onRetry={() => q.refetch()} />
        : !q.data?.length ? <p className="px-1 text-sm text-muted-foreground">No requests yet.</p>
        : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {q.data.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="flex-1 font-medium">{PRIVACY_KIND[r.kind]}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", PRIVACY_STATUS[r.status]?.className)}>{PRIVACY_STATUS[r.status]?.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">Sent {fmtDateTime(r.created_at)}</p>
                {r.outcome && <p className="whitespace-pre-wrap">{r.outcome}</p>}
                {r.retained?.length > 0 && <p className="text-xs text-muted-foreground">Kept by law: {r.retained.join("; ")}</p>}
                {r.status === "pending" && <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground" disabled={!!busy} onClick={() => withdraw(r.id)}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        )}
    </CommPage>
  );
}
