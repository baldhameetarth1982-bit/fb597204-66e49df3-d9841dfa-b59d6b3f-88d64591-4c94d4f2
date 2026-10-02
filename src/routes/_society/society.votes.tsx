import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gavel, Loader2, Plus, Lock, X } from "lucide-react";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";
import { govRpc, govError, ELIGIBILITY, fmtDateTime } from "@/lib/governance";
import { VoteResults } from "@/components/governance/VoteResults";

export const Route = createFileRoute("/_society/society/votes")({
  head: () => ({
    meta: [
      { title: "Formal Votes — SociyoHub" },
      { name: "description", content: "Run formal society votes with server-checked eligibility, one vote per person or home, and optional secret ballot." },
      { property: "og:title", content: "Formal Votes — SociyoHub" },
      { property: "og:description", content: "Formal society votes with eligibility checks and secret ballot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VotesAdmin,
});

type Vote = { id: string; title: string; description: string | null; status: string; closes_at: string; eligibility: string; secret_ballot: boolean; frozen_at: string | null };
const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  open: { label: "Voting open", className: "bg-primary/10 text-primary" },
  closed: { label: "Voting closed", className: "bg-secondary text-secondary-foreground" },
};
const EMPTY = { title: "", description: "", options: ["In favour", "Against", "Abstain"], eligibility: "home", secret: false, closes: "" };

function VotesAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["admin-votes", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("polls").select("id,title,description,status,closes_at,eligibility,secret_ballot,frozen_at")
        .eq("society_id", societyId!).eq("kind", "vote").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Vote[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-votes"] });

  async function create() {
    setBusy(true);
    try {
      await govRpc("vote_create", { _title: form.title, _description: form.description, _options: form.options.map((o) => o.trim()).filter(Boolean),
        _eligibility: form.eligibility, _secret: form.secret, _closes_at: form.closes ? new Date(form.closes).toISOString() : null });
      toast.success("Vote saved as draft. Settings lock when you open voting.");
      setCreating(false); setForm(EMPTY); refresh();
    } catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }
  async function setStatus(id: string, s: "open" | "closed") {
    const msg = s === "open" ? "Open voting now? Title, options, eligibility and closing time will be locked." : "Close voting now? Closed votes can't be reopened.";
    if (!confirm(msg)) return;
    setBusy(true);
    try { await govRpc("vote_set_status", { _id: id, _status: s }); toast.success(s === "open" ? "Voting is open — eligible residents are notified" : "Voting closed"); refresh(); qc.invalidateQueries({ queryKey: ["vote-results", id] }); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }

  const open = q.data?.find((v) => v.id === openId) ?? null;

  return (
    <PageShell>
      <PageHeader title="Formal votes" description="For decisions that need a proper vote. Community polls stay separate."
        actions={<Button className="rounded-xl min-h-11" onClick={() => { setForm(EMPTY); setCreating(true); }}><Plus className="h-4 w-4 mr-2" />New vote</Button>} />
      {q.isLoading ? <ListSkeleton rows={3} />
        : q.isError ? <LoadError title="We couldn't load votes." onRetry={() => q.refetch()} />
        : !q.data?.length ? <ListEmpty icon={Gavel} title="No formal votes yet">Create a vote when a decision needs recorded, one-per-person or one-per-home voting.</ListEmpty>
        : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {q.data.map((v) => (
              <li key={v.id}>
                <button onClick={() => setOpenId(v.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <Gavel className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.title}</span>
                    <span className="block text-xs text-muted-foreground">{ELIGIBILITY[v.eligibility]}{v.secret_ballot ? " · Secret ballot" : ""} · closes {fmtDateTime(v.closes_at)}</span>
                  </span>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", STATUS[v.status]?.className)}>{STATUS[v.status]?.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>New formal vote</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-4 py-4">
            <div><Label htmlFor="v-title">Question *</Label><Input id="v-title" className="h-11" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="v-desc">Details</Label><Textarea id="v-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Options (2–10)</Label>
              {form.options.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="h-11" maxLength={120} value={o} aria-label={`Option ${i + 1}`} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {form.options.length > 2 && <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Remove option ${i + 1}`} onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>}
                </div>
              ))}
              {form.options.length < 10 && <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setForm({ ...form, options: [...form.options, ""] })}>Add option</Button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Who can vote</Label>
                <Select value={form.eligibility} onValueChange={(v) => setForm({ ...form, eligibility: v })}><SelectTrigger aria-label="Who can vote" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ELIGIBILITY).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label htmlFor="v-close">Voting closes *</Label><Input id="v-close" type="datetime-local" className="h-11" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} /></div>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.checked })} />
              <span><span className="block font-medium">Secret ballot</span><span className="block text-xs text-muted-foreground">Nobody, including the committee, can see individual choices. Totals appear after voting closes.</span></span>
            </label>
            <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={create}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save as draft"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          {open && (
            <div className="mx-auto max-w-2xl space-y-4 pb-6">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", STATUS[open.status]?.className)}>{STATUS[open.status]?.label}</span>
                <SheetTitle className="text-left text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              {open.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{open.description}</p>}
              <p className="text-sm">{ELIGIBILITY[open.eligibility]}{open.secret_ballot ? " · Secret ballot" : ""} · closes {fmtDateTime(open.closes_at)}</p>
              {open.frozen_at && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden />Settings locked since {fmtDateTime(open.frozen_at)}</p>}
              {open.status !== "draft" && <VoteResults pollId={open.id} />}
              <div className="flex gap-2">
                {open.status === "draft" && <Button className="h-12 flex-1 rounded-xl" disabled={busy} onClick={() => setStatus(open.id, "open")}>Open voting</Button>}
                {open.status === "open" && <Button variant="outline" className="h-12 flex-1 rounded-xl" disabled={busy} onClick={() => setStatus(open.id, "closed")}>Close voting now</Button>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
