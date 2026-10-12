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
import { listMySaasUpiPayments, submitSaasUpiPayment } from "@/lib/saas-upi-payment.functions";

const MESSAGES: Record<string, string> = {
  invalid_file: "Upload a JPG, PNG or WEBP screenshot under 5 MB.",
  duplicate_reference: "This transaction ID was already submitted.",
  already_pending: "A UPI payment for your society is already waiting for review.",
  price_changed: "The plan price changed. Refresh the page and scan the new QR.",
  invalid_paid_at: "Pick the time you paid (within the last 7 days).",
  rate_limited: "Too many tries. Please wait a while and try again.",
  upi_unavailable: "UPI payment is switched off right now.",
  custom_pricing: "Your society has custom pricing. Please talk to us.",
  not_authorized: "Only your society's admins can pay for the plan.",
};
const REJECT: Record<string, string> = {
  short_paid: "Less than the plan total was received",
  not_received: "The money hasn't reached us",
  wrong_reference: "The transaction ID didn't match",
  unclear_proof: "The screenshot wasn't clear",
  duplicate: "This payment was already used",
  other: "We couldn't verify it",
};
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
    if (!/^[A-Za-z0-9]{8,35}$/.test(r)) return toast.error("Enter the UPI transaction ID (UTR) — 8 to 35 letters or numbers.");
    if (payer.trim().length < 2) return toast.error("Enter the name on the paying account.");
    if (payerUpi && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(payerUpi.trim())) return toast.error("Check the payer UPI ID, or leave it empty.");
    if (!file || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error(MESSAGES.invalid_file);
    if (!agreeExact || !agreeTerms) return toast.error("Please tick both boxes to continue.");
    const when = new Date(paidAt);
    if (Number.isNaN(when.getTime())) return toast.error(MESSAGES.invalid_paid_at);
    setBusy(true);
    try {
      await submit({ data: {
        societyId: p.societyId, planId: p.planId, ...(p.flatQuantity ? { flatQuantity: p.flatQuantity } : {}),
        requestId: requestId.current, expectedAmountPaise: p.amountPaise, utr: r, payerName: payer.trim(),
        payerUpi: payerUpi.trim(), paidAt: when.toISOString(), consent: true, proofBase64: await toBase64(file),
      } });
      toast.success("Sent for verification. We'll notify you once it's checked.");
      requestId.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: ["saas-upi-mine", p.societyId] });
    } catch (e) {
      toast.error(MESSAGES[(e as Error).message] ?? "Couldn't submit right now. Please try again.");
    } finally { setBusy(false); }
  }

  if (mine.isLoading) return <div className="py-6 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (pending) {
    return (
      <div role="status" className="rounded-2xl border border-border bg-secondary/50 p-5 text-center space-y-2">
        <Clock className="mx-auto h-8 w-8 text-primary" />
        <p className="font-semibold">Payment under review</p>
        <p className="text-sm text-muted-foreground">
          {inr(pending.amount_paise)} · UTR ending {pending.utr.slice(-4)}. Your plan starts as soon as we confirm the money
          has arrived — usually within 24 hours on working days. You'll get a notification.
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
            <p className="font-medium">Last payment not verified: {REJECT[lastRejected.reject_code ?? "other"]}.</p>
            {lastRejected.reject_code === "short_paid" && lastRejected.received_amount_paise != null && (
              <p className="text-muted-foreground mt-0.5">
                Received {inr(lastRejected.received_amount_paise)} of {inr(lastRejected.amount_paise)}. Pay the remaining{" "}
                {inr(Math.max(lastRejected.amount_paise - lastRejected.received_amount_paise, 0))} or email us for a refund.
              </p>
            )}
            {lastRejected.review_note && <p className="text-muted-foreground mt-0.5">{lastRejected.review_note}</p>}
          </div>
        </div>
      )}

      {/* QR card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-primary px-5 py-3 text-primary-foreground">
          <p className="text-xs uppercase tracking-wider opacity-80">Step 1 · Scan & pay</p>
          <p className="font-semibold">Pay {p.payeeName} by UPI</p>
        </div>
        <div className="flex flex-col items-center gap-3 p-5">
          <div className="rounded-2xl border-4 border-primary/15 bg-background p-3">
            <QRCodeSVG value={upiLink} size={208} level="M" marginSize={2} aria-label={`UPI QR to pay ${inr(p.amountPaise)}`} className="h-52 w-52" />
          </div>
          <p className="text-3xl font-bold tabular-nums">{inr(p.amountPaise)}</p>
          <dl className="w-full max-w-xs space-y-1 text-sm">
            {p.basePaise != null && (
              <div className="flex justify-between"><dt className="text-muted-foreground">{p.planName} plan</dt><dd className="tabular-nums">{inr(p.basePaise)}</dd></div>
            )}
            {(p.taxPaise ?? 0) > 0 && (
              <div className="flex justify-between"><dt className="text-muted-foreground">GST{p.taxPercent ? ` (${p.taxPercent}%)` : ""}</dt><dd className="tabular-nums">{inr(p.taxPaise!)}</dd></div>
            )}
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>Total to pay</dt><dd className="tabular-nums">{inr(p.amountPaise)}</dd></div>
          </dl>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(p.upiVpa); toast.success("UPI ID copied"); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium"
          >
            {p.upiVpa} <Copy className="h-4 w-4" />
          </button>
          <Button asChild className="h-11 w-full max-w-xs rounded-xl sm:hidden">
            <a href={upiLink}><Smartphone className="mr-2 h-4 w-4" />Open UPI app</a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Works with Google Pay, PhonePe, Paytm, BHIM and any UPI app. The exact amount is filled in for you —
            please don't change it. We never ask for your UPI PIN or OTP.
          </p>
        </div>
      </div>

      {/* Proof form */}
      <div className="space-y-4 rounded-2xl border border-border p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Step 2 · Send payment details</p>
        <div className="space-y-1">
          <Label htmlFor="upi-utr">UPI transaction ID (UTR / UPI Ref No.)</Label>
          <Input id="upi-utr" autoComplete="off" maxLength={35} value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s/g, ""))} className="h-11 tabular-nums" placeholder="12-digit number on your receipt" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="upi-payer">Name on paying account</Label>
            <Input id="upi-payer" maxLength={80} value={payer} onChange={(e) => setPayer(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upi-payer-id">Your UPI ID (optional)</Label>
            <Input id="upi-payer-id" maxLength={130} value={payerUpi} onChange={(e) => setPayerUpi(e.target.value.trim())} className="h-11" placeholder="name@bank" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="upi-when">When did you pay?</Label>
          <Input id="upi-when" type="datetime-local" value={paidAt} max={localNow()} onChange={(e) => setPaidAt(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="upi-proof">Payment screenshot</Label>
          <Input id="upi-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-11" />
          <p className="text-xs text-muted-foreground">Show the amount, UTR, date and "Success". Crop out your bank balance.</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={agreeExact} onCheckedChange={(v) => setAgreeExact(v === true)} className="mt-0.5" />
          <span>I paid exactly {inr(p.amountPaise)} to {p.upiVpa}, and the details and screenshot are real and unedited.</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={agreeTerms} onCheckedChange={(v) => setAgreeTerms(v === true)} className="mt-0.5" />
          <span>
            I agree to the <Link to="/terms" className="underline">Terms</Link> and{" "}
            <Link to="/refund" className="underline">Refund Policy</Link>, and allow SociyoHub to keep these details to
            verify the payment as explained in the <Link to="/privacy" className="underline">Privacy Policy</Link>. The plan starts only after verification.
          </span>
        </label>
        <Button className="h-12 w-full rounded-xl" disabled={busy || !agreeExact || !agreeTerms} onClick={() => void onSubmit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Submit for verification
        </Button>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Your screenshot is stored privately and seen only by SociyoHub's verification team.</p>
      </div>

      {mine.data?.some((r) => r.status === "approved") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" />Earlier UPI payments were verified — see receipts in Plan & billing.</p>
      )}
    </div>
  );
}
