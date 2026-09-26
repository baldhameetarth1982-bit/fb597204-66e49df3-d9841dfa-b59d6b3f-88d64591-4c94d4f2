import { toast } from "sonner";

declare global {
  interface Window { Razorpay?: any }
}

let scriptPromise: Promise<boolean> | null = null;
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => { scriptPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export interface RzpOrderOpts {
  orderId: string;
  keyId: string;
  amount: number; // paise
  name?: string;
  description?: string;
  prefill?: { email?: string; contact?: string; name?: string };
  onSuccess: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void | Promise<void>;
  onDismiss?: () => void;
}

/** Open Razorpay with a pre-created, server-authoritative order. */
export async function openRazorpayForOrder(opts: RzpOrderOpts) {
  if (!opts.keyId) { toast.error("Razorpay key missing"); return false; }
  const ok = await loadRazorpayScript();
  if (!ok) { toast.error("Could not load Razorpay. Check your internet."); return false; }
  const options = {
    key: opts.keyId,
    amount: opts.amount,
    currency: "INR",
    order_id: opts.orderId,
    name: opts.name ?? "SociyoHub",
    description: opts.description ?? "Maintenance bill",
    prefill: opts.prefill ?? {},
    theme: { color: "#0F766E" },
    handler: (resp: any) => {
      void Promise.resolve(opts.onSuccess(resp)).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Payment confirmation failed. Please contact support.");
        opts.onDismiss?.();
      });
    },
    modal: { ondismiss: () => opts.onDismiss?.() },
  };
  const rzp = new window.Razorpay!(options);
  rzp.on("payment.failed", (resp: any) => {
    toast.error(resp?.error?.description ?? "Payment failed");
    opts.onDismiss?.();
  });
  rzp.open();
  return true;
}
