import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import {
  ArrowLeft, Download, Share2, Copy, Loader2, AlertCircle, CheckCircle2, XCircle, Clock, Banknote, Landmark, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { MobileScreen } from "@/components/shared/MobileScreen";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type SmartQrSubmission, getSmartQrFn, setSmartQrActiveFn, reviewSmartQrSubmissionFn } from "@/lib/smart-qr.functions";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import { inr, REVIEW_ERRORS } from "@/lib/smart-qr-ui";

export const Route = createFileRoute("/_society/society/qr/$id")({
  head: () => ({
    meta: [
      { title: "Smart QR — SociyoHub" },
      { name: "description", content: "Share your collection QR and review payment submissions." },
    ],
  }),
  component: () => {
    const { id } = Route.useParams();
    return <IncomeAccessBoundary>{() => <QrDetail id={id} />}</IncomeAccessBoundary>;
  },
});

type Filter = "submitted" | "recorded" | "rejected";

function QrDetail({ id }: { id: string }) {
  const getFn = useServerFn(getSmartQrFn);
  const activeFn = useServerFn(setSmartQrActiveFn);
  const qc = useQueryClient();
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [toggling, setToggling] = useState(false);
  const [filter, setFilter] = useState<Filter>("submitted");
  const q = useQuery({ queryKey: ["smart-qr", "detail", id], queryFn: () => getFn({ data: { id } }), staleTime: 15_000 });

  if (q.isLoading) {
    return (
      <MobileScreen className="max-w-3xl space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </MobileScreen>
    );
  }
  if (q.error) {
    const s = toSafeFinanceError(q.error);
    return (
      <MobileScreen className="max-w-3xl">
        <BackLink />
        <div className="rounded-2xl border bg-card p-6 text-center">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
          <p className="font-medium">{s.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{s.message}</p>
          {s.retryable && <Button className="mt-3 min-h-11" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>Retry</Button>}
        </div>
      </MobileScreen>
    );
  }
  if (!q.data?.found) {
    return (
      <MobileScreen className="max-w-3xl">
        <BackLink />
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="font-medium">QR code not found</p>
          <p className="mt-1 text-sm text-muted-foreground">It may belong to another society or no longer exist.</p>
        </div>
      </MobileScreen>
    );
  }

  const { qr, submissions } = q.data;
  const url = typeof window !== "undefined" ? `${window.location.origin}/q/${qr.token}` : `/q/${qr.token}`;
  const expired = !!qr.expiresAt && new Date(qr.expiresAt) <= new Date();
  const counts = {
    submitted: submissions.filter((s) => s.status === "submitted").length,
    recorded: submissions.filter((s) => s.status === "recorded").length,
    rejected: submissions.filter((s) => s.status === "rejected").length,
  };
  const recordedTotal = submissions.filter((s) => s.status === "recorded" && s.verification === "verified").reduce((a, s) => a + s.amount, 0);
  const shown = submissions.filter((s) => s.status === filter);

  function download() {
    const canvas = canvasWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${qr.title.replace(/[^\w-]+/g, "-").slice(0, 40)}-qr.png`;
    a.click();
  }
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: qr.title, text: `Pay for ${qr.title}`, url }); } catch { /* cancelled */ }
    } else copy();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy the link"); }
  }
  async function toggle(v: boolean) {
    if (toggling) return;
    setToggling(true);
    try {
      const r = await activeFn({ data: { id: qr.id, active: v } });
      if (r.status === "success") {
        toast.success(v ? "QR is accepting payments" : "QR paused");
        await qc.invalidateQueries({ queryKey: ["smart-qr"] });
      } else toast.error(REVIEW_ERRORS[r.status] ?? REVIEW_ERRORS.temporary_error);
    } catch {
      toast.error(REVIEW_ERRORS.temporary_error);
    } finally {
      setToggling(false);
    }
  }

  const live = qr.isActive && !expired;
  const reviewFirst = counts.submitted > 0;

  return (
    <MobileScreen className="max-w-5xl space-y-5">
      <BackLink />

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">{qr.categoryName}</p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">{qr.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {qr.fixedAmount ? `${inr(qr.fixedAmount)} per payment` : "Any amount"}
            {qr.expiresAt ? ` · closes ${new Date(qr.expiresAt).toLocaleDateString("en-IN")}` : ""}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${live ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`} />
          {expired ? "Expired" : qr.isActive ? "Live" : "Paused"}
        </span>
      </header>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border">
        <div className="min-w-0 bg-card p-3.5">
          <dt className="text-xs text-muted-foreground">To review</dt>
          <dd className={`mt-1 text-xl font-semibold tabular-nums ${counts.submitted ? "text-warning" : ""}`}>{counts.submitted}</dd>
        </div>
        <div className="min-w-0 bg-card p-3.5">
          <dt className="text-xs text-muted-foreground">Verified collected</dt>
          <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{inr(recordedTotal)}</dd>
        </div>
        <div className="min-w-0 bg-card p-3.5">
          <dt className="text-xs text-muted-foreground">Submissions</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{submissions.length}</dd>
        </div>
      </dl>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
        <section className={`min-w-0 ${reviewFirst ? "order-1" : "order-2 md:order-1"}`} aria-label="Submissions">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="submitted" className="min-h-10">To review ({counts.submitted})</TabsTrigger>
              <TabsTrigger value="recorded" className="min-h-10">Recorded ({counts.recorded})</TabsTrigger>
              <TabsTrigger value="rejected" className="min-h-10">Rejected ({counts.rejected})</TabsTrigger>
            </TabsList>
          </Tabs>
          {filter === "submitted" && counts.submitted > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Check your bank statement before recording. Recorded entries still need verification in Income.
            </p>
          )}
          <div className="mt-3 space-y-2.5">
            {shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                {filter === "submitted" ? "Nothing to review. Submissions from payers will appear here." : "Nothing here yet."}
              </div>
            ) : (
              shown.map((s) => <SubmissionCard key={s.id} s={s} />)
            )}
          </div>
        </section>

        <aside className={`space-y-3 md:sticky md:top-20 ${reviewFirst ? "order-2" : "order-1 md:order-2"}`} aria-label="Share this QR">
          <div className="rounded-2xl border bg-card p-4">
            <div ref={canvasWrap} className={`mx-auto w-fit rounded-xl border bg-white p-3 ${live ? "" : "opacity-40"}`}>
              <QRCodeCanvas value={url} size={200} level="M" marginSize={1} />
            </div>
            {!live && (
              <p className="mt-2 text-center text-xs font-medium text-muted-foreground">
                {expired ? "Expired — payers can no longer submit" : "Paused — payers can't submit right now"}
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button variant="outline" className="min-h-11 flex-col gap-0.5 px-1 text-xs" onClick={download}><Download className="h-4 w-4" />Save</Button>
              <Button variant="outline" className="min-h-11 flex-col gap-0.5 px-1 text-xs" onClick={share}><Share2 className="h-4 w-4" />Share</Button>
              <Button variant="outline" className="min-h-11 flex-col gap-0.5 px-1 text-xs" onClick={copy}><Copy className="h-4 w-4" />Copy link</Button>
            </div>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-muted/60 px-3">
              <span className="text-sm font-medium">Accepting payments</span>
              <Switch checked={qr.isActive} disabled={toggling} onCheckedChange={toggle} aria-label="Accepting payments" />
            </label>
          </div>
          <details className="group rounded-2xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">
              Where money goes
              <span className="text-xs text-muted-foreground group-open:hidden">••••{qr.accountNumber.slice(-4)}</span>
            </summary>
            <dl className="space-y-1.5 border-t px-4 py-3 text-sm">
              <Row k="Account holder" v={qr.payeeName} />
              <Row k="Account" v={`••••${qr.accountNumber.slice(-4)}`} />
              <Row k="IFSC" v={qr.ifsc} />
              <Row k="Cash" v={qr.acceptsCash ? "Accepted" : "Not accepted"} />
            </dl>
          </details>
        </aside>
      </div>
    </MobileScreen>
  );
}

function BackLink() {
  return (
    <Link to="/society/qr" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Smart QR
    </Link>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  );
}

type Sub = SmartQrSubmission;

const VERIFY_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending verification", cls: "bg-warning/10 text-warning" },
  verified: { label: "Verified", cls: "bg-success/10 text-success" },
  rejected: { label: "Rejected in Income", cls: "bg-destructive/10 text-destructive" },
  reversed: { label: "Reversed", cls: "bg-muted text-muted-foreground" },
};

function SubmissionCard({ s }: { s: Sub }) {
  const reviewFn = useServerFn(reviewSmartQrSubmissionFn);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | "record" | "reject">(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function act(action: "record" | "reject") {
    if (busy) return;
    setBusy(action);
    try {
      const r = await reviewFn({ data: { id: s.id, action, reason: action === "reject" ? reason.trim() : undefined } });
      if (r.status === "recorded") toast.success("Added to Income as pending verification");
      else if (r.status === "rejected") toast.success("Submission rejected");
      else toast.error(REVIEW_ERRORS[r.status] ?? REVIEW_ERRORS.temporary_error);
      if (r.status === "recorded" || r.status === "rejected" || r.status === "already_processed") {
        setRejectOpen(false);
        await qc.invalidateQueries({ queryKey: ["smart-qr"] });
      }
    } catch {
      toast.error(REVIEW_ERRORS.temporary_error);
    } finally {
      setBusy(null);
    }
  }

  const v = s.verification ? VERIFY_LABEL[s.verification] : null;
  return (
    <article className="rounded-2xl border bg-card p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          {s.method === "cash" ? <Banknote className="h-5 w-5 text-muted-foreground" /> : <Landmark className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-medium">{s.payerName}</p>
            <p className="shrink-0 font-semibold tabular-nums">{inr(s.amount)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {s.method === "cash" ? "Cash" : "Bank transfer"} · paid {new Date(s.paidOn).toLocaleDateString("en-IN")}
            {s.payerPhone ? ` · ${s.payerPhone}` : ""}
          </p>
          {s.reference && <p className="mt-0.5 break-all text-xs"><span className="text-muted-foreground">Ref </span><span className="font-mono">{s.reference}</span></p>}
          {s.note && <p className="mt-1 text-xs text-muted-foreground">"{s.note}"</p>}
          {s.status === "rejected" && s.reviewReason && <p className="mt-1 text-xs text-destructive">Reason: {s.reviewReason}</p>}
        </div>
      </div>

      {s.status === "submitted" && (
        <>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Check your bank statement before recording.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => setRejectOpen(true)}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
            <Button className="min-h-11" disabled={!!busy} onClick={() => act("record")}>
              {busy === "record" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1.5 h-4 w-4" /> Record</>}
            </Button>
          </div>
        </>
      )}
      {s.status === "recorded" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {v && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>{v.label}</span>}
          {s.incomeRecordId && (
            <Link to="/society/income/$id" params={{ id: s.incomeRecordId }} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
              {s.verification === "pending" ? "Verify in Income" : "Open in Income"} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      <AlertDialog open={rejectOpen} onOpenChange={(o) => !busy && setRejectOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this submission?</AlertDialogTitle>
            <AlertDialogDescription>The payer's claim of {inr(s.amount)} won't be added to income. This is kept in history.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} maxLength={300} rows={3} placeholder="Reason, e.g. No matching credit in bank statement" onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy || reason.trim().length < 3}
              onClick={(e) => { e.preventDefault(); void act("reject"); }}
            >
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
