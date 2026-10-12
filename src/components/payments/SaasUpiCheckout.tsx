import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Clock, Copy, Loader2, ShieldCheck, Smartphone, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import { listMySaasUpiPayments, submitSaasUpiPayment } from "@/lib/saas-upi-payment.functions";

const ERR_CODES = ["invalid_file", "duplicate_reference", "already_pending", "price_changed", "invalid_paid_at", "rate_limited", "upi_unavailable", "custom_pricing", "not_authorized"];
const REJECT_CODES = ["short_paid", "not_received", "wrong_reference", "unclear_proof", "duplicate", "other"];
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function toBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function localNow() {
  const d = new Date(); d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Props = {
  societyId: string;
  planId: "basic" | "pro" | "premium";
  planName: string;
  flatQuantity?: number;
  amountPaise: number;
  basePaise: number | null;
  taxPaise: number | null;
  taxPercent: number | null;
  upiVpa: string;
  payeeName: string;
};

export function SaasUpiCheckout(p: Props) {
  const { t } = useTranslation();
  const errMsg = (c: string) => (ERR_CODES.includes(c) ? t(`ln.upi.e.${c}`) : t("ln.upi.fail"));
  const reason = (c: string | null) => t(`ln.upi.r.${REJECT_CODES.includes(c ?? "") ? c : "other"}`);
  const qc = useQueryClient();
  const submit = useServerFn(submitSaasUpiPayment);
  const listMine = useServerFn(listMySaasUpiPayments);
  const mine = useQuery({
    queryKey: ["saas-upi-mine", p.societyId],
    queryFn: () => listMine({ data: { societyId: p.societyId } }),
    staleTime: 15_000,
  });
  const requestId = useRef(crypto.randomUUID());
  const [utr, setUtr] = useState("");
  const [payer, setPayer] = useState("");
  const [payerUpi, setPayerUpi] = useState("");
  const [paidAt, setPaidAt] = useState(localNow);
  const [file, setFile] = useState<File | null>(null);
  const [agreeExact, setAgreeExact] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);

  const amount = (p.amountPaise / 100).toFixed(2);
  const note = `SociyoHub ${p.planName} plan`;
  const upiLink = `upi://pay?pa=${encodeURIComponent(p.upiVpa)}&pn=${encodeURIComponent(p.payeeName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
  const pending = mine.data?.find((r) => r.status === "pending");
  const lastRejected = mine.data?.[0]?.status === "rejected" ? mine.data[0] : null;

  async function onSubmit() {
    if (busy) return;
    const r = utr.trim();
    if (!/^[A-Za-z0-9]{8,35}$/.test(r)) return toast.error(t("ln.upi.errUtr"));
    if (payer.trim().length < 2) return toast.error(t("ln.upi.errPayer"));
    if (payerUpi && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(payerUpi.trim())) return toast.error(t("ln.upi.errPayerUpi"));
    if (!file || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error(t("ln.upi.e.invalid_file"));
    if (!agreeExact || !agreeTerms) return toast.error(t("ln.upi.tickBoth"));
    const when = new Date(paidAt);
    if (Number.isNaN(when.getTime())) return toast.error(t("ln.upi.e.invalid_paid_at"));
    setBusy(true);
    try {
      await submit({ data: {
        societyId: p.societyId, planId: p.planId, ...(p.flatQuantity ? { flatQuantity: p.flatQuantity } : {}),
        requestId: requestId.current, expectedAmountPaise: p.amountPaise, utr: r, payerName: payer.trim(),
        payerUpi: payerUpi.trim(), paidAt: when.toISOString(), consent: true, proofBase64: await toBase64(file),
      } });
      toast.success(t("ln.upi.sent"));
      requestId.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: ["saas-upi-mine", p.societyId] });
    } catch (e) {
      toast.error(errMsg((e as Error).message));
    } finally { setBusy(false); }
  }

  if (mine.isLoading) return <div className="py-6 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (pending) {
    return (
      <div role="status" className="rounded-2xl border border-border bg-secondary/50 p-5 text-center space-y-2">
        <Clock className="mx-auto h-8 w-8 text-primary" />
        <p className="font-semibold">{t("ln.upi.reviewTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {t("ln.upi.reviewBody", { amount: inr(pending.amount_paise), last4: pending.utr.slice(-4) })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {lastRejected && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <XCircle className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{t("ln.upi.lastRejected", { reason: reason(lastRejected.reject_code) })}</p>
            {lastRejected.reject_code === "short_paid" && lastRejected.received_amount_paise != null && (
              <p className="text-muted-foreground mt-0.5">
                {t("ln.upi.shortBody", { got: inr(lastRejected.received_amount_paise), total: inr(lastRejected.amount_paise), left: inr(Math.max(lastRejected.amount_paise - lastRejected.received_amount_paise, 0)) })}
              </p>
            )}
            {lastRejected.review_note && <p className="text-muted-foreground mt-0.5">{lastRejected.review_note}</p>}
          </div>
        </div>
      )}

      {/* QR card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-primary px-5 py-3 text-primary-foreground">
          <p className="text-xs uppercase tracking-wider opacity-80">{t("ln.upi.step1")}</p>
          <p className="font-semibold">{t("ln.upi.payTo", { name: p.payeeName })}</p>
        </div>
        <div className="flex flex-col items-center gap-3 p-5">
          <div className="rounded-2xl border-4 border-primary/15 bg-background p-3">
            <QRCodeSVG value={upiLink} size={208} level="M" marginSize={2} aria-label={`UPI QR to pay ${inr(p.amountPaise)}`} className="h-52 w-52" />
          </div>
          <p className="text-3xl font-bold tabular-nums">{inr(p.amountPaise)}</p>
          <dl className="w-full max-w-xs space-y-1 text-sm">
            {p.basePaise != null && (
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("ln.upi.plan", { plan: p.planName })}</dt><dd className="tabular-nums">{inr(p.basePaise)}</dd></div>
            )}
            {(p.taxPaise ?? 0) > 0 && (
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("ln.upi.gst")}{p.taxPercent ? ` (${p.taxPercent}%)` : ""}</dt><dd className="tabular-nums">{inr(p.taxPaise!)}</dd></div>
            )}
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>{t("ln.upi.total")}</dt><dd className="tabular-nums">{inr(p.amountPaise)}</dd></div>
          </dl>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(p.upiVpa); toast.success(t("ln.upi.copied")); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium"
          >
            {p.upiVpa} <Copy className="h-4 w-4" />
          </button>
          <Button asChild className="h-11 w-full max-w-xs rounded-xl sm:hidden">
            <a href={upiLink}><Smartphone className="mr-2 h-4 w-4" />{t("ln.upi.openApp")}</a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("ln.upi.apps")}
          </p>
        </div>
      </div>

      {/* Proof form */}
      <div className="space-y-4 rounded-2xl border border-border p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("ln.upi.step2")}</p>
        <div className="space-y-1">
          <Label htmlFor="upi-utr">{t("ln.upi.utr")}</Label>
          <Input id="upi-utr" autoComplete="off" maxLength={35} value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s/g, ""))} className="h-11 tabular-nums" placeholder={t("ln.upi.utrHint")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="upi-payer">{t("ln.upi.payer")}</Label>
            <Input id="upi-payer" maxLength={80} value={payer} onChange={(e) => setPayer(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upi-payer-id">{t("ln.upi.payerUpi")}</Label>
            <Input id="upi-payer-id" maxLength={130} value={payerUpi} onChange={(e) => setPayerUpi(e.target.value.trim())} className="h-11" placeholder="name@bank" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="upi-when">{t("ln.upi.when")}</Label>
          <Input id="upi-when" type="datetime-local" value={paidAt} max={localNow()} onChange={(e) => setPaidAt(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="upi-proof">{t("ln.upi.shot")}</Label>
          <Input id="upi-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-11" />
          <p className="text-xs text-muted-foreground">{t("ln.upi.shotHint")}</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={agreeExact} onCheckedChange={(v) => setAgreeExact(v === true)} className="mt-0.5" />
          <span>{t("ln.upi.agreeExact", { amount: inr(p.amountPaise), vpa: p.upiVpa })}</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={agreeTerms} onCheckedChange={(v) => setAgreeTerms(v === true)} className="mt-0.5" />
          <span>
            {t("ln.upi.agreeTerms")}{" "}
            <Link to="/terms" className="underline">{t("ln.upi.terms")}</Link> ·{" "}
            <Link to="/refund" className="underline">{t("ln.upi.refund")}</Link> ·{" "}
            <Link to="/privacy" className="underline">{t("ln.upi.privacy")}</Link>
          </span>
        </label>
        <Button className="h-12 w-full rounded-xl" disabled={busy || !agreeExact || !agreeTerms} onClick={() => void onSubmit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{t("ln.upi.submit")}
        </Button>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />{t("ln.upi.private")}</p>
      </div>

      {mine.data?.some((r) => r.status === "approved") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" />{t("ln.upi.earlier")}</p>
      )}
    </div>
  );
}
