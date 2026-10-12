import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Image as ImageIcon, Loader2, QrCode, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  adminGetSaasUpiProof, adminListSaasUpiPayments, adminReviewSaasUpiPayment, adminSetSaasPaymentMethods,
  getSaasPaymentMethods, type AdminUpiPayment,
} from "@/lib/saas-upi-payment.functions";

export const Route = createFileRoute("/_admin/admin/upi-payments")({
  head: () => ({
    meta: [
      { title: "UPI plan payments — SociyoHub Super Admin" },
      { name: "description", content: "Verify manual UPI payments for SociyoHub plans." },
      { property: "og:title", content: "UPI plan payments — SociyoHub Super Admin" },
      { property: "og:description", content: "Verify manual UPI payments for SociyoHub plans." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UpiPaymentsPage,
});

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const REASONS = [
  ["short_paid", "Short payment (less than total)"],
  ["not_received", "Money not received"],
  ["wrong_reference", "UTR doesn't match"],
  ["unclear_proof", "Screenshot unclear"],
  ["duplicate", "Duplicate / already used"],
  ["other", "Other"],
] as const;
type Tab = "pending" | "approved" | "rejected";

function UpiPaymentsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const list = useServerFn(adminListSaasUpiPayments);
  const q = useQuery({ queryKey: ["admin-saas-upi", tab], queryFn: () => list({ data: { status: tab, before: null } }), refetchInterval: tab === "pending" ? 30_000 : false });
  const [open, setOpen] = useState<AdminUpiPayment | null>(null);

  return (
    <PageShell>
      <PageHeader title="UPI plan payments" description="Check each payment arrived in your UPI app before approving. Approving starts the plan and issues the receipt." />
      <SettingsCard />
      <div role="tablist" className="mb-4 flex gap-2">
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`min-h-11 rounded-full px-4 text-sm font-medium capitalize ${tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
            {t === "pending" ? "To verify" : t}
          </button>
        ))}
      </div>
      {q.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : q.isError ? (
        <ErrorState title="Payments couldn't load" onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing here.</div>
      ) : (
        <ul className="space-y-3">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.society_name}</p>
                <p className="text-sm text-muted-foreground">{r.plan_name} · {r.flat_count} flats · {r.payer_name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">UTR {r.utr} · paid {when(r.paid_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold tabular-nums">{inr(r.amount_paise)}</span>
                {r.status !== "pending" && <Badge variant={r.status === "approved" ? "default" : "destructive"} className="capitalize">{r.status}</Badge>}
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(r)}>{r.status === "pending" ? "Review" : "View"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <ReviewDialog row={open} onClose={() => setOpen(null)} />}
    </PageShell>
  );
}

function ReviewDialog({ row, onClose }: { row: AdminUpiPayment; onClose: () => void }) {
  const qc = useQueryClient();
  const proof = useServerFn(adminGetSaasUpiProof);
  const review = useServerFn(adminReviewSaasUpiPayment);
  const img = useQuery({ queryKey: ["admin-saas-upi-proof", row.id], queryFn: () => proof({ data: { id: row.id } }), staleTime: 240_000 });
  const [mode, setMode] = useState<"view" | "reject">("view");
  const [code, setCode] = useState<(typeof REASONS)[number][0]>("short_paid");
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = row.status === "pending";

  async function act(approve: boolean) {
    setBusy(true);
    try {
      const rec = received.trim() ? Math.round(Number(received) * 100) : null;
      if (rec !== null && (!Number.isFinite(rec) || rec < 0)) { toast.error("Enter the received amount in rupees."); setBusy(false); return; }
      const res = await review({ data: { id: row.id, approve, rejectCode: approve ? null : code, receivedAmountPaise: approve ? null : rec, note: note.trim() || null } });
      toast.success(res.replayed ? "Already reviewed." : approve ? `Approved. Receipt ${res.receipt_number ?? ""}` : "Rejected and the society was told why.");
      await qc.invalidateQueries({ queryKey: ["admin-saas-upi"] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message === "not_authorized" ? "Only the Super Admin can review payments." : "Couldn't save. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.society_name}</DialogTitle>
          <DialogDescription>Open your UPI app ({row.payee_vpa}) and confirm {inr(row.amount_paise)} with UTR {row.utr} arrived.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Plan</dt><dd>{row.plan_name} · {row.term_months} mo</dd>
          <dt className="text-muted-foreground">Flats × rate</dt><dd className="tabular-nums">{row.flat_count} × ₹{row.price_per_flat_inr}</dd>
          {row.base_amount_paise != null && <><dt className="text-muted-foreground">Base</dt><dd className="tabular-nums">{inr(row.base_amount_paise)}</dd></>}
          {(row.tax_amount_paise ?? 0) > 0 && <><dt className="text-muted-foreground">GST{row.tax_percent ? ` ${row.tax_percent}%` : ""}</dt><dd className="tabular-nums">{inr(row.tax_amount_paise!)}</dd></>}
          <dt className="font-semibold">Expected total</dt><dd className="font-semibold tabular-nums">{inr(row.amount_paise)}</dd>
          <dt className="text-muted-foreground">UTR</dt><dd className="break-all tabular-nums">{row.utr}</dd>
          <dt className="text-muted-foreground">Payer</dt><dd>{row.payer_name}{row.payer_upi ? ` · ${row.payer_upi}` : ""}</dd>
          <dt className="text-muted-foreground">Paid at</dt><dd>{when(row.paid_at)}</dd>
          <dt className="text-muted-foreground">Submitted</dt><dd>{when(row.created_at)}</dd>
          {row.reject_code && <><dt className="text-muted-foreground">Reason</dt><dd>{REASONS.find((r) => r[0] === row.reject_code)?.[1]}</dd></>}
          {row.review_note && <><dt className="text-muted-foreground">Note</dt><dd>{row.review_note}</dd></>}
        </dl>
        <div className="grid min-h-40 place-items-center overflow-hidden rounded-xl border border-border bg-muted/40">
          {img.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : img.data?.url ? (
            <a href={img.data.url} target="_blank" rel="noreferrer noopener"><img src={img.data.url} alt="Payment screenshot" className="max-h-96 w-full object-contain" /></a>
          ) : <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><ImageIcon className="h-4 w-4" />Screenshot unavailable</p>}
        </div>
        {pending && mode === "reject" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rej-code">Reason</Label>
              <select id="rej-code" value={code} onChange={(e) => setCode(e.target.value as typeof code)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {code === "short_paid" && (
              <div className="space-y-1">
                <Label htmlFor="rej-recv">Amount actually received (₹)</Label>
                <Input id="rej-recv" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} className="h-11 tabular-nums" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="rej-note">Message to the society (optional)</Label>
              <Textarea id="rej-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
        {pending && (
          <DialogFooter className="gap-2 sm:gap-2">
            {mode === "view" ? (
              <>
                <Button variant="outline" className="h-11 rounded-xl" disabled={busy} onClick={() => setMode("reject")}><XCircle className="mr-2 h-4 w-4" />Reject</Button>
                <Button className="h-11 rounded-xl" disabled={busy} onClick={() => void act(true)}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Money received — approve
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="h-11 rounded-xl" disabled={busy} onClick={() => setMode("view")}>Back</Button>
                <Button variant="destructive" className="h-11 rounded-xl" disabled={busy} onClick={() => void act(false)}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reject payment
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsCard() {
  const qc = useQueryClient();
  const get = useServerFn(getSaasPaymentMethods);
  const save = useServerFn(adminSetSaasPaymentMethods);
  const q = useQuery({ queryKey: ["saas-payment-methods"], queryFn: () => get() });
  const [vpa, setVpa] = useState("");
  const [name, setName] = useState("");
  const [upiOn, setUpiOn] = useState(true);
  const [rzpLocked, setRzpLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setVpa(q.data.upiVpa); setName(q.data.payeeName); setUpiOn(q.data.upiEnabled); setRzpLocked(q.data.razorpayLocked);
  }, [q.data]);

  async function onSave() {
    setBusy(true);
    try {
      await save({ data: { razorpayLocked: rzpLocked, upiEnabled: upiOn, upiVpa: vpa.trim(), payeeName: name.trim() } });
      toast.success("Payment options saved.");
      await qc.invalidateQueries({ queryKey: ["saas-payment-methods"] });
    } catch { toast.error("Check the UPI ID and name, then try again."); } finally { setBusy(false); }
  }

  if (!q.data) return null;
  return (
    <section className="mb-6 space-y-4 rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 font-semibold"><QrCode className="h-4 w-4 text-primary" />Plan payment options</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="pp-vpa">Your UPI ID (money goes here)</Label><Input id="pp-vpa" value={vpa} onChange={(e) => setVpa(e.target.value.trim())} className="h-11" /></div>
        <div className="space-y-1"><Label htmlFor="pp-name">Name shown to payers</Label><Input id="pp-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="h-11" /></div>
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>UPI payment on</span><Switch checked={upiOn} onCheckedChange={setUpiOn} /></label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>Card payment (Razorpay) locked — shows "Temporarily out of service"</span><Switch checked={rzpLocked} onCheckedChange={setRzpLocked} /></label>
      <Button className="h-11 rounded-xl" disabled={busy} onClick={() => void onSave()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
    </section>
  );
}
