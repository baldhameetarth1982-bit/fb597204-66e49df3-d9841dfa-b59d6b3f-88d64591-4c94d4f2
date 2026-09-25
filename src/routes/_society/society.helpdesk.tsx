import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Gavel, Inbox, Loader2, UserCheck, XCircle } from "lucide-react";
import { SummaryStrip, SearchField, SegmentedFilter, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { TicketTimeline } from "@/components/helpdesk/TicketTimeline";
import {
  CATEGORY_LABEL, PRIORITY_LABEL, fmtDate, helpdeskErrorMessage, statusMeta,
  type TicketCategory, type TicketPriority,
} from "@/lib/helpdesk";

export const Route = createFileRoute("/_society/society/helpdesk")({
  head: () => ({
    meta: [
      { title: "Helpdesk queue — SociyoHub" },
      { name: "description", content: "Resident complaints, service requests and committee approvals in one queue." },
    ],
  }),
  component: HelpdeskQueue,
});

interface Row {
  id: string; ticket_no: number; subject: string; description: string; category: TicketCategory; priority: string;
  status: string; requires_approval: boolean; approval_status: string | null; assigned_to: string | null;
  assignee_name: string | null; requester_name: string; flat_label: string | null; created_at: string; last_activity_at: string;
}

type View = "needs_action" | "approvals" | "in_progress" | "resolved" | "all";
const VIEWS: { key: View; label: string; match: (r: Row) => boolean }[] = [
  { key: "needs_action", label: "New", match: (r) => r.status === "open" },
  { key: "approvals", label: "Approvals", match: (r) => r.status === "awaiting_approval" },
  { key: "in_progress", label: "In progress", match: (r) => r.status === "in_progress" },
  { key: "resolved", label: "Resolved", match: (r) => r.status === "resolved" },
  { key: "all", label: "All", match: () => true },
];

const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: "in_progress", label: "Start work" }, { to: "awaiting_approval", label: "Send for approval" }, { to: "resolved", label: "Mark resolved" }, { to: "rejected", label: "Reject" }],
  in_progress: [{ to: "resolved", label: "Mark resolved" }, { to: "awaiting_approval", label: "Send for approval" }],
  resolved: [{ to: "closed", label: "Close" }, { to: "in_progress", label: "Reopen" }],
};

function HelpdeskQueue() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("needs_action");
  const [term, setTerm] = useState("");
  const search = useDeferredValue(term.trim().toLowerCase());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["helpdesk", "queue"],
    staleTime: 20_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_admin_queue", { _limit: 300 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const team = useQuery({
    queryKey: ["helpdesk", "assignees"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_assignees");
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, (q.data ?? []).filter(v.match).length])), [q.data]);
  const rows = useMemo(() => {
    const m = VIEWS.find((v) => v.key === view)!.match;
    return (q.data ?? []).filter((r) => m(r) && (!search ||
      `${r.subject} ${r.requester_name} ${r.flat_label ?? ""} ${r.ticket_no}`.toLowerCase().includes(search)));
  }, [q.data, view, search]);
  const sel = q.data?.find((r) => r.id === selectedId) ?? null;

  const done = (msg: string) => { toast.success(msg); setNote(""); qc.invalidateQueries({ queryKey: ["helpdesk"] }); };

  const update = useMutation({
    mutationFn: async (v: { status?: string; assign?: string | null }) => {
      const { error } = await supabase.rpc("helpdesk_admin_update", {
        _ticket: sel!.id,
        _status: v.status ?? undefined,
        _assign: v.assign ?? undefined,
        _unassign: v.assign === null,
        _note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => done(v.status ? `Marked ${statusMeta(v.status).label.toLowerCase()}` : "Assignment updated"),
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await supabase.rpc("helpdesk_decide_approval", { _ticket: sel!.id, _approve: approve, _reason: note.trim() || undefined });
      if (error) throw error;
    },
    onSuccess: (_d, approve) => done(approve ? "Approved — moved to in progress" : "Rejected"),
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });
  const busy = update.isPending || decide.isPending;

  const nextAction = (r: Row) =>
    r.status === "awaiting_approval" ? "Committee decision needed"
      : r.status === "open" ? (r.assigned_to ? "Start work" : "Assign an owner")
      : r.status === "in_progress" ? "Resolve when done"
      : r.status === "resolved" ? "Waiting for resident to confirm" : null;
  const val = (k: View) => (q.data ? counts[k] : "—");

  return (
    <PageShell>
      <PageHeader title="Helpdesk" description="What needs action from the committee." />

      <SummaryStrip items={[
        { label: "New", value: val("needs_action"), hint: "Not started" },
        { label: "Approvals", value: val("approvals"), hint: "Need a decision" },
        { label: "In progress", value: val("in_progress") },
        { label: "Resolved", value: val("resolved"), hint: "Awaiting confirmation" },
      ]} />

      <div className="mb-4 flex flex-col gap-3">
        <SearchField value={term} onChange={setTerm} placeholder="Search title, resident, house or #number" label="Search requests" />
        <SegmentedFilter label="Request status" value={view} onChange={setView}
          options={VIEWS.map((v) => ({ key: v.key, label: v.label, count: q.data ? counts[v.key] : undefined }))} />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        New member join requests are under <Link to="/society/approvals" className="font-medium text-primary underline-offset-2 hover:underline">Resident approvals</Link>.
      </p>

      {q.isPending ? <ListSkeleton rows={5} />
        : q.isError ? <LoadError title="Couldn't load the helpdesk queue." onRetry={() => q.refetch()} />
        : rows.length === 0 ? (
          <ListEmpty icon={Inbox} title={search ? "No matches" : "All clear"}>{search ? "Try a different search." : "Nothing waiting in this view."}</ListEmpty>
        ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((r) => {
            const s = statusMeta(r.status);
            const urgent = r.priority === "high" || r.priority === "urgent";
            const approval = r.status === "awaiting_approval";
            const na = nextAction(r);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => { setSelectedId(r.id); setNote(""); }}
                  className={`relative grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[1fr_12rem_11rem] md:items-center md:gap-4 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r ${approval ? "before:bg-info bg-info-container/30" : urgent ? "before:bg-destructive" : r.status === "open" ? "before:bg-primary" : "before:bg-transparent"}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {approval && <Gavel className="h-3.5 w-3.5 text-info" aria-label="Approval request" />}
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${s.tone}`}>{s.label}</span>
                      {urgent && <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive">{PRIORITY_LABEL[r.priority as TicketPriority]}</span>}
                      <span>{CATEGORY_LABEL[r.category] ?? "Request"} · #{r.ticket_no}</span>
                    </span>
                    <span className="mt-0.5 block truncate font-medium">{r.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.requester_name}{r.flat_label ? ` · ${r.flat_label}` : ""}</span>
                  </span>
                  <span className="text-xs text-muted-foreground md:text-sm">{r.assignee_name ? `Owner: ${r.assignee_name}` : "Unassigned"} · {fmtDate(r.last_activity_at)}</span>
                  {na && <span className={`text-xs font-medium md:text-right md:text-sm ${approval ? "text-info" : "text-foreground"}`}>{na} →</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}


      <Sheet open={!!sel} onOpenChange={(o) => !o && !busy && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg">
          {sel && (
            <div className="space-y-5">
              <SheetHeader className="text-left">
                <p className="text-xs text-muted-foreground">#{sel.ticket_no} · {CATEGORY_LABEL[sel.category]} · {PRIORITY_LABEL[sel.priority as TicketPriority] ?? sel.priority}</p>
                <SheetTitle className="break-words">{sel.subject}</SheetTitle>
                <p className="text-sm text-muted-foreground">{sel.requester_name}{sel.flat_label ? ` · ${sel.flat_label}` : ""} · raised {fmtDate(sel.created_at)}</p>
                <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta(sel.status).tone}`}>{statusMeta(sel.status).label}</span>
              </SheetHeader>
              <p className="whitespace-pre-wrap break-words text-sm">{sel.description}</p>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="hd-owner">Owner</label>
                <Select
                  value={sel.assigned_to ?? "none"}
                  disabled={busy || ["closed", "rejected", "cancelled"].includes(sel.status) || team.isError}
                  onValueChange={(v) => update.mutate({ assign: v === "none" ? null : v })}
                >
                  <SelectTrigger id="hd-owner" className="min-h-11 rounded-xl"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(team.data ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {(sel.status === "awaiting_approval" || NEXT[sel.status]) && (
                <div className="space-y-3 rounded-2xl border p-3">
                  <label htmlFor="hd-note" className="text-sm font-medium">
                    {sel.status === "awaiting_approval" ? "Committee decision" : "Note to resident"}
                    <span className="font-normal text-muted-foreground"> (required to reject)</span>
                  </label>
                  <Textarea id="hd-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="rounded-xl" placeholder="Shown on the resident's timeline" />
                  {sel.status === "awaiting_approval" ? (
                    <div className="flex gap-2">
                      <Button className="min-h-11 flex-1 rounded-xl" disabled={busy} onClick={() => decide.mutate(true)}>
                        {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</>}
                      </Button>
                      <Button variant="outline" className="min-h-11 flex-1 rounded-xl" disabled={busy || note.trim().length < 3} onClick={() => decide.mutate(false)}>
                        <XCircle className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {NEXT[sel.status].map((n) => (
                        <Button key={n.to} variant={n.to === "rejected" ? "outline" : n.to === "resolved" ? "default" : "secondary"}
                          className="min-h-11 rounded-xl" disabled={busy || (n.to === "rejected" && note.trim().length < 3)}
                          onClick={() => update.mutate({ status: n.to })}>
                          {n.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {sel.status === "awaiting_approval" && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><UserCheck className="h-3.5 w-3.5" /> Only committee members with settings access can decide.</p>
                  )}
                </div>
              )}

              <TicketTimeline ticketId={sel.id} canComment={!["closed", "cancelled"].includes(sel.status)} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
