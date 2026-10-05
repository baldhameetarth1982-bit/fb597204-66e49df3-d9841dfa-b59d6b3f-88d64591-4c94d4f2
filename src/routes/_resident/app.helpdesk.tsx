import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy, Plus, Loader2, AlertCircle, Sparkles, Wrench, PackageSearch, Gavel, RefreshCw, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { TicketTimeline } from "@/components/helpdesk/TicketTimeline";
import { ResidentTicketExtras } from "@/components/helpdesk/ResidentTicketExtras";
import {
  PRIORITY_LABEL, categoryHint, categoryLabel, priorityLabel, fmtDate, helpdeskErrorMessage, statusMeta,
  type TicketCategory, type TicketPriority,
} from "@/lib/helpdesk";

const CATS: TicketCategory[] = ["complaint", "maintenance", "daily_help", "approval", "lost_found"];
const ICONS: Record<TicketCategory, typeof AlertCircle> = {
  complaint: AlertCircle, maintenance: Wrench, daily_help: Sparkles, approval: Gavel, lost_found: PackageSearch,
};

const searchSchema = z.object({
  cat: z.enum(["complaint", "daily_help", "maintenance", "lost_found", "approval", "all"]).optional(),
  new: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/_resident/app/helpdesk")({
  head: () => ({
    meta: [
      { title: "Helpdesk — SociyoHub" },
      { name: "description", content: "Raise complaints, service requests and approval requests, and track them to resolution." },
    ],
  }),
  validateSearch: searchSchema,
  component: HelpdeskPage,
});

interface Ticket {
  id: string; ticket_no: number; subject: string; description: string; status: string;
  priority: string; category: TicketCategory; created_at: string; last_activity_at: string;
  resolution_note: string | null; approval_status: string | null;
}

type Tab = "active" | "done";
const DONE = ["closed", "rejected", "cancelled"];

function HelpdeskPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_resident/app/helpdesk" });
  const initialCat: TicketCategory = search.cat && search.cat !== "all" ? search.cat : "complaint";

  const [tab, setTab] = useState<Tab>("active");
  const [openNew, setOpenNew] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ category: initialCat, subject: "", description: "", priority: "normal" as TicketPriority });

  useEffect(() => {
    if (search.new) {
      setOpenNew(true);
      navigate({ to: "/app/helpdesk", search: { cat: search.cat }, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = useQuery({
    queryKey: ["helpdesk", "mine", user?.id],
    enabled: !!user,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, ticket_no, subject, description, status, priority, category, created_at, last_activity_at, resolution_note, approval_status")
        .eq("user_id", user!.id)
        .order("last_activity_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });

  const list = useMemo(
    () => (q.data ?? []).filter((x) => (tab === "done" ? DONE.includes(x.status) : !DONE.includes(x.status))),
    [q.data, tab],
  );
  const current = q.data?.find((x) => x.id === selected) ?? null;

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_create_ticket", {
        _category: form.category, _subject: form.subject.trim(), _description: form.description.trim(), _priority: form.priority,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success(form.category === "approval" ? t("hd.t.sentApproval") : t("hd.t.raised"));
      setOpenNew(false);
      setForm((f) => ({ ...f, subject: "", description: "", priority: "normal" }));
      setTab("active");
      qc.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error(helpdeskErrorMessage(e)), // form kept for retry
  });

  const act = useMutation({
    mutationFn: async (v: { id: string; action: "cancel" | "confirm" | "reopen" }) => {
      const { error } = await supabase.rpc("helpdesk_resident_action", { _ticket: v.id, _action: v.action });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === "cancel" ? t("hd.t.cancelled") : v.action === "confirm" ? t("hd.t.closed") : t("hd.t.reopened"));
      qc.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });

  function startNew(cat: TicketCategory) {
    setForm({ category: cat, subject: "", description: "", priority: "normal" });
    setOpenNew(true);
  }

  const subjectOk = form.subject.trim().length >= 3;
  const descOk = form.description.trim().length >= 5;

  const attention = tab === "active" ? list.filter((x) => x.status === "resolved") : [];
  const approvals = tab === "active" ? list.filter((x) => x.status !== "resolved" && x.category === "approval") : [];
  const others = tab === "active" ? list.filter((x) => x.status !== "resolved" && x.category !== "approval") : list;

  const tr = t;
  const row = (t: Ticket) => {
    const s = statusMeta(t.status);
    const Icon = ICONS[t.category] ?? LifeBuoy;
    const urgent = t.priority === "high" || t.priority === "urgent";
    const isApproval = t.category === "approval";
    const NEXT: Record<string, string> = { resolved: "hd.n.resolved", awaiting_approval: "hd.n.approval", open: "hd.n.open", in_progress: "hd.n.progress", on_hold: "hd.n.hold", reopened: "hd.n.reopened" };
    const next = NEXT[t.status] ? tr(NEXT[t.status]) : null;
    return (
      <li key={t.id}>
        <button type="button" onClick={() => setSelected(t.id)}
          className={`relative flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r ${t.status === "resolved" ? "before:bg-success" : urgent ? "before:bg-destructive" : isApproval ? "before:bg-info" : "before:bg-transparent"}`}>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isApproval ? "bg-info-container text-info-container-foreground" : "bg-muted"}`}><Icon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${s.tone}`}>{s.label}</span>
              {urgent && <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive">{priorityLabel(t.priority)}</span>}
              <span>{categoryLabel(t.category)} · #{t.ticket_no}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium">{t.subject}</span>
            <span className="block text-xs text-muted-foreground">{next ? `${next} · ` : ""}{tr("hd.updated", { date: fmtDate(t.last_activity_at) })}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </li>
    );
  };
  const group = (label: string, items: Ticket[], hint?: string) => items.length > 0 && (
    <div>
      <h2 className="mb-1 mt-5 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}<span className="rounded-full bg-muted px-1.5 tabular-nums">{items.length}</span></h2>
      {hint && <p className="mb-2 px-1 text-xs text-muted-foreground">{hint}</p>}
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{items.map(row)}</ul>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-5">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("hd.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("hd.subtitle")}</p>
        </div>
        <Button onClick={() => startNew(initialCat)} className="min-h-11 shrink-0 rounded-xl">
          <Plus className="mr-1 h-4 w-4" /> {t("hd.new")}
        </Button>
      </header>

      <section aria-label={t("hd.mine")}>
        <div role="tablist" className="inline-flex rounded-xl bg-secondary p-1">
          {(["active", "done"] as Tab[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`min-h-11 rounded-lg px-4 text-sm font-medium ${tab === k ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
              {k === "active" ? t("hd.tab.active") : t("hd.tab.past")}
            </button>
          ))}
        </div>

        {q.isPending ? (
          <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
        ) : q.isError ? (
          <div role="alert" className="mt-4 rounded-2xl border border-dashed bg-card p-6 text-center">
            <p className="font-semibold">{t("hd.loadFailed")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{helpdeskErrorMessage(q.error)}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> {t("common.tryAgain")}
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed bg-card p-8 text-center">
            <LifeBuoy className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">{tab === "active" ? t("hd.emptyActive") : t("hd.emptyPast")}</p>
            <p className="text-xs text-muted-foreground">{tab === "active" ? t("hd.emptyActiveHint") : t("hd.emptyPastHint")}</p>
          </div>
        ) : (
          <>
            {group(t("hd.g.attention"), attention, t("hd.g.attentionHint"))}
            {group(t("hd.g.approvals"), approvals, t("hd.g.approvalsHint"))}
            {group(tab === "active" ? t("hd.g.open") : t("hd.g.past"), others)}
          </>
        )}
      </section>

      <section aria-label={t("hd.start")} className="mt-8">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("hd.start")}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATS.map((c) => {
            const Icon = ICONS[c];
            return (
              <button key={c} type="button" onClick={() => startNew(c)}
                className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{categoryLabel(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{categoryHint(c)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>


      {/* New request */}
      <Sheet open={openNew} onOpenChange={(o) => !create.isPending && setOpenNew(o)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader><SheetTitle>{t("hd.new")}</SheetTitle></SheetHeader>
          <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); if (subjectOk && descOk && !create.isPending) create.mutate(); }}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("cm.type")}</legend>
              <div className="flex flex-wrap gap-2">
                {CATS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, category: c })} aria-pressed={form.category === c}
                    className={`min-h-10 rounded-full border px-3 text-sm ${form.category === c ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
                    {categoryLabel(c)}
                  </button>
                ))}
              </div>
              {form.category === "approval" && (
                <p className="text-xs text-muted-foreground">{t("hd.approvalNote")}</p>
              )}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="hd-subject">{t("cm.fTitle")}</Label>
              <Input id="hd-subject" value={form.subject} maxLength={120} className="min-h-11 rounded-xl"
                placeholder={t("hd.subjectPh")} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hd-desc">{t("hd.details")}</Label>
              <Textarea id="hd-desc" value={form.description} rows={4} maxLength={2000} className="rounded-xl"
                placeholder={t("hd.descPh")}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <p className="text-right text-[11px] text-muted-foreground">{form.description.length}/2000</p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("hd.priority")}</legend>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => (
                  <button key={p} type="button" aria-pressed={form.priority === p} onClick={() => setForm({ ...form, priority: p })}
                    className={`min-h-11 rounded-xl border text-sm ${form.priority === p ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}>
                    {priorityLabel(p)}
                  </button>
                ))}
              </div>
            </fieldset>
            <Button type="submit" className="min-h-12 w-full rounded-xl" disabled={!subjectOk || !descOk || create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.category === "approval" ? t("hd.sendApproval") : t("hd.submit")}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={!!current} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          {current && (
            <div className="space-y-5">
              <SheetHeader className="text-left">
                <p className="text-xs text-muted-foreground">#{current.ticket_no} · {categoryLabel(current.category)}</p>
                <SheetTitle className="break-words">{current.subject}</SheetTitle>
                <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta(current.status).tone}`}>{statusMeta(current.status).label}</span>
              </SheetHeader>
              <p className="whitespace-pre-wrap break-words text-sm">{current.description}</p>
              <AISummaryCard key={current.id} target={{ kind: "ticket", id: current.id }} />
              {current.resolution_note && (
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground">{current.status === "rejected" ? t("cm.reason") : t("hd.resolution")}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{current.resolution_note}</p>
                </div>
              )}
              {current.status === "resolved" && (
                <div className="flex gap-2">
                  <Button className="min-h-11 flex-1 rounded-xl" disabled={act.isPending} onClick={() => act.mutate({ id: current.id, action: "confirm" })}>{t("hd.fixed")}</Button>
                  <Button variant="outline" className="min-h-11 flex-1 rounded-xl" disabled={act.isPending} onClick={() => act.mutate({ id: current.id, action: "reopen" })}>{t("hd.stillIssue")}</Button>
                </div>
              )}
              {(current.status === "open" || current.status === "awaiting_approval") && (
                <Button variant="ghost" className="min-h-11 w-full rounded-xl text-destructive" disabled={act.isPending}
                  onClick={() => act.mutate({ id: current.id, action: "cancel" })}>{t("hd.cancelReq")}</Button>
              )}
              <ResidentTicketExtras ticketId={current.id} status={current.status} />
              <TicketTimeline ticketId={current.id} canComment={!["closed", "cancelled"].includes(current.status)} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
