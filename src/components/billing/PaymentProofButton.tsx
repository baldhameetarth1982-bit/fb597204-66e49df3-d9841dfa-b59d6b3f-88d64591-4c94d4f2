import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPaymentProofUrl } from "@/lib/upi-qr-payment.functions";
import { tu } from "@/lib/i18n";

/** Committee view of a resident's UPI payment screenshot via a short signed link. */
export function PaymentProofButton({ paymentId }: { paymentId: string }) {
  const fetchUrl = useServerFn(getPaymentProofUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const r = await fetchUrl({ data: { paymentId } });
      if (!r.url) toast.error(tu("op.no_screenshot_was_attached"));
      setUrl(r.url);
    } catch { toast.error(tu("op.couldn_t_open_the_screenshot")); }
    finally { setBusy(false); }
  }
  if (url) return <a href={url} target="_blank" rel="noreferrer noopener"><img src={url} alt={tu("op.payment_screenshot")} className="max-h-80 w-auto rounded-lg border border-border" /></a>;
  return (
    <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => void load()} disabled={busy}>
      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-1 h-4 w-4" />}{tu("op.view_payment_screenshot")}
    </Button>
  );
}
