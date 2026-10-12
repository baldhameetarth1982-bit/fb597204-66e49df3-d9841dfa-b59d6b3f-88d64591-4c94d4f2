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
import { getSaasUpiQuote, listMySaasUpiPayments, submitSaasUpiPayment } from "@/lib/saas-upi-payment.functions";

const ERR_CODES = ["invalid_file", "duplicate_reference", "already_pending", "price_changed", "invalid_paid_at", "rate_limited", "upi_unavailable", "custom_pricing", "not_authorized", "code_invalid"];
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
  initialTerm?: 1 | 3 | 12;
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
  const [term, setTerm] = useState<1 | 3 | 12>(p.initialTerm ?? 1);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const fetchQuote = useServerFn(getSaasUpiQuote);
  const quoteQ = useQuery({
    queryKey: ["saas-upi-quote", p.societyId, p.planId, p.flatQuantity ?? null, term, code],
    queryFn: () => fetchQuote({ data: { societyId: p.societyId, planId: p.planId, ...(p.flatQuantity ? { flatQuantity: p.flatQuantity } : {}), termMonths: term, discountCode: code } }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const q = quoteQ.data;
  const amountPaise = q?.amount_paise ?? 0;
  const codeOk = q?.discount_code_status === "applied";
  const [utr, setUtr] = useState("");
  const [payer, setPayer] = useState("");
  const [payerUpi, setPayerUpi] = useState("");
  const [paidAt, setPaidAt] = useState(localNow);
  const [file, setFile] = useState<File | null>(null);
  const [agreeExact, setAgreeExact] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);

  const amount = (amountPaise / 100).toFixed(2);
  const note = `SociyoHub ${p.planName} ${term}M`;
  const upiLink = `upi://pay?pa=${encodeURIComponent(p.upiVpa)}&pn=${encodeURIComponent(p.payeeName)}&am=${amount}&mam=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
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
    if (!q || amountPaise <= 0 || quoteQ.isFetching) return;
    if (code && !codeOk) return toast.error(t("ln.upi.e.code_invalid"));
    setBusy(true);
    try {
      await submit({ data: {
        societyId: p.societyId, planId: p.planId, ...(p.flatQuantity ? { flatQuantity: p.flatQuantity } : {}),
        termMonths: term, discountCode: codeOk ? code : "",
        requestId: requestId.current, expectedAmountPaise: amountPaise, utr: r, payerName: payer.trim(),
        payerUpi: payerUpi.trim(), paidAt: when.toISOString(), consent: true, proofBase64: await toBase64(file),
      } });
      toast.success(t("ln.upi.sent"));
      requestId.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: ["saas-upi-mine", p.societyId] });
    } catch (e) {
      const m = (e as Error).message;
      toast.error(errMsg(m));
      if (m === "code_invalid") { setCode(""); setCodeInput(""); }
      if (m === "price_changed" || m === "code_invalid") void quoteQ.refetch();
    } finally { setBusy(false); }
  }

  if (mine.isLoading || (quoteQ.isLoading && !q)) return <div className="py-6 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

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

      {/* Plan length + discount code */}
      <div className="space-y-4 rounded-2xl border border-border p-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("ln.sub.term")}</p>
          <div role="radiogroup" aria-label={t("ln.sub.term")} className="grid grid-cols-3 gap-2">
            {([1, 3, 12] as const).map((m) => {
              const pct = m === 3 ? 6 : m === 12 ? 8 : 0;
              return (
                <button key={m} type="button" role="radio" aria-checked={term === m}
                  onClick={() => { setTerm(m); requestId.current = crypto.randomUUID(); }}
                  className={`min-h-[64px] rounded-xl border-2 p-2 text-center transition-colors ${term === m ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="block text-sm font-semibold">{t(`ln.sub.m${m}`)}</span>
                  {pct > 0 && <span className="mt-1 inline-block rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">{t("ln.sub.save", { pct })}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="upi-code">{t("ln.sub.code")}</Label>
          <div className="flex gap-2">
            <Input id="upi-code" autoComplete="off" maxLength={24} value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              className="h-11 uppercase" disabled={!!code} />
            {code ? (
              <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => { setCode(""); setCodeInput(""); requestId.current = crypto.randomUUID(); }}>{t("ln.sub.remove")}</Button>
            ) : (
              <Button type="button" variant="secondary" className="h-11 rounded-xl" disabled={codeInput.length < 3}
                onClick={() => { setCode(codeInput); requestId.current = crypto.randomUUID(); }}>{t("ln.sub.apply")}</Button>
            )}
          </div>
          {code && q?.discount_code_status && !quoteQ.isFetching && (
            <p role="status" className={`text-xs ${codeOk ? "text-success" : "text-destructive"}`}>
              {codeOk ? t("ln.sub.applied", { pct: q.discount_code_percent }) : t(`ln.sub.c.${q.discount_code_status}`)}
            </p>
          )}
        </div>
      </div>

      {quoteQ.isError || !q || amountPaise <= 0 ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
          {t("ln.upi.fail")}
          <Button variant="outline" className="ml-2 min-h-11" onClick={() => void quoteQ.refetch()}>{t("ln.sub.retry")}</Button>
        </div>
      ) : (<>
      {/* QR card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-primary px-5 py-3 text-primary-foreground">
          <p className="text-xs uppercase tracking-wider opacity-80">{t("ln.upi.step1")}</p>
          <p className="font-semibold">{t("ln.upi.payTo", { name: p.payeeName })}</p>
        </div>
        <div className="flex flex-col items-center gap-3 p-5">
          <div className="rounded-2xl border-4 border-primary/15 bg-background p-3">
            <QRCodeSVG value={upiLink} size={208} level="M" marginSize={2} aria-label={`UPI QR to pay ${inr(amountPaise)}`} className="h-52 w-52" />
          </div>
          <p className={`text-3xl font-bold tabular-nums ${quoteQ.isFetching ? "opacity-50" : ""}`}>{inr(amountPaise)}</p>
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("ln.upi.plan", { plan: p.planName })} · {t("ln.sub.months", { n: q.term_months })}</dt><dd className="tabular-nums">{inr(q.gross_amount_paise ?? q.base_amount_paise ?? 0)}</dd></div>
            {q.term_discount_paise > 0 && (
              <div className="flex justify-between gap-3 text-success"><dt>{t("ln.sub.termSave", { pct: q.term_discount_percent })}</dt><dd className="tabular-nums">−{inr(q.term_discount_paise)}</dd></div>
            )}
            {q.code_discount_paise > 0 && (
              <div className="flex justify-between gap-3 text-success"><dt>{t("ln.sub.codeSave", { code: q.discount_code })}</dt><dd className="tabular-nums">−{inr(q.code_discount_paise)}</dd></div>
            )}
            {(q.tax_amount_paise ?? 0) > 0 && (
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("ln.upi.gst")}{q.tax_percent ? ` (${q.tax_percent}%)` : ""}</dt><dd className="tabular-nums">{inr(q.tax_amount_paise!)}</dd></div>
            )}
            <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>{t("ln.upi.total")}</dt><dd className="tabular-nums">{inr(amountPaise)}</dd></div>
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
          <span>{t("ln.upi.agreeExact", { amount: inr(amountPaise), vpa: p.upiVpa })}</span>
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
        <Button className="h-12 w-full rounded-xl" disabled={busy || !agreeExact || !agreeTerms || quoteQ.isFetching} onClick={() => void onSubmit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{t("ln.upi.submit")}
        </Button>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />{t("ln.upi.private")}</p>
      </div>
      </>)}

      {mine.data?.some((r) => r.status === "approved") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" />{t("ln.upi.earlier")}</p>
      )}
    </div>
  );
}
