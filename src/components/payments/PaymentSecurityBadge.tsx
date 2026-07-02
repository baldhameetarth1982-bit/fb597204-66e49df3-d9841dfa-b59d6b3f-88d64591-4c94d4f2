import { ShieldCheck, Lock } from "lucide-react";

export function PaymentSecurityBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-xs text-muted-foreground ${className}`}
      aria-label="Payment security"
    >
      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
      <span>Secured by Razorpay</span>
      <span className="opacity-40">·</span>
      <Lock className="h-3 w-3" aria-hidden />
      <span>128-bit SSL Encrypted Transactions</span>
    </div>
  );
}
