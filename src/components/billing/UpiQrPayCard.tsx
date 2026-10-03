import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, QrCode, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBillUpiDetails, submitUpiQrPayment } from "@/lib/upi-qr-payment.functions";

const MESSAGES: Record<string, string> = {
  invalid_reference: "Enter the UPI transaction ID (UTR) — 8 to 35 letters or numbers.",
  invalid_file: "Upload a JPG, PNG or WEBP screenshot under 5 MB.",
  duplicate_reference: "This transaction ID has already been submitted.",
  offline_payment_pending: "A payment for this bill is already waiting for the committee to check it.",
  nothing_due: "Nothing is due on this bill.",
  bill_cancelled: "This bill was cancelled.",
  rate_limited: "Too many tries. Please wait a while and try again.",
  not_authorized: "Only current residents of this home can pay.",
  plan_required: "UPI payment isn't part of your society's plan.",
  not_configured: "Your society hasn't set up UPI payments yet.",
};

const INR = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

async function toBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function UpiQrPayCard({ billId, onSubmitted }: { billId: string; onSubmitted: () => void }) {
  const details = useServerFn(getBillUpiDetails);
  const submit = useServerFn(submitUpiQrPayment);
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [idKey] = useState(() => `upi_${crypto.randomUUID()}`);
  const q = useQuery({ queryKey: ["bill-upi", billId], queryFn: () => details({ data: { billId } }), staleTime: 30_000 });

  if (q.isLoading || q.isError || !q.data?.available) return null;
  const d = q.data;
  if (d.amountDue <= 0) return null;
  const upiLink = `upi://pay?pa=${encodeURIComponent(d.upiVpa)}&pn=${encodeURIComponent(d.payeeName)}&am=${d.amountDue.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Maintenance ${d.billNumber ?? ""}`.trim())}`;

  async function onSubmit() {
    if (busy) return;
    const r = ref.trim();
    if (!/^[A-Za-z0-9]{8,35}$/.test(r)) { toast.error(MESSAGES.invalid_reference); return; }
    if (!file || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error(MESSAGES.invalid_file); return; }
    setBusy(true);
    try {
      await submit({ data: { billId, referenceNo: r, idempotencyKey: idKey, proofBase64: await toBase64(file) } });
      setDone(true);
      toast.success("Sent for verification. The bill stays unpaid until the committee checks it.");
      onSubmitted();
    } catch (e) {
      toast.error(MESSAGES[(e as Error).message] ?? "Couldn't submit right now. Please try again.");
    } finally { setBusy(false); }
  }

  if (done) {
    return <div role="status" className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">UPI payment sent for verification. You'll get a receipt once the committee confirms it — don't pay again.</div>;
  }

  return (
    <div className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <p className="font-medium">Pay by UPI QR</p>
        <p className="text-sm text-muted-foreground">Scan your society's QR in any UPI app, then send the transaction ID and a screenshot. No extra fee.</p>
      </div>
      {!open ? (
        <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setOpen(true)}><QrCode className="h-4 w-4 mr-2" />Show UPI QR</Button>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/50 p-4">
            {d.qrUrl
              ? <img src={d.qrUrl} alt={`UPI QR for ${d.payeeName}`} className="h-52 w-52 rounded-lg bg-card object-contain" />
              : <div className="rounded-lg bg-card p-3"><QRCodeSVG value={upiLink} size={192} aria-label={`UPI QR for ${d.payeeName}`} /></div>}
            <p className="text-sm font-medium">{d.payeeName}</p>
            <p className="text-xs text-muted-foreground break-all">{d.upiVpa}</p>
            <p className="text-lg font-semibold tabular-nums">Pay {INR(d.amountDue)}</p>
            <a href={upiLink} className="text-sm font-medium text-primary underline-offset-4 hover:underline sm:hidden">Open UPI app</a>
          </div>
          <div className="space-y-1">
            <Label htmlFor="upi-ref">UPI transaction ID (UTR)</Label>
            <Input id="upi-ref" inputMode="text" autoComplete="off" maxLength={35} value={ref} onChange={(e) => setRef(e.target.value.replace(/\s/g, ""))} className="h-11" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upi-proof">Payment screenshot</Label>
            <Input id="upi-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-11" />
          </div>
          <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={() => void onSubmit()}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Submit for verification
          </Button>
          <p className="text-xs text-muted-foreground">Sending a screenshot doesn't mark the bill paid. The committee checks it against the society's bank account first.</p>
        </div>
      )}
    </div>
  );
}
