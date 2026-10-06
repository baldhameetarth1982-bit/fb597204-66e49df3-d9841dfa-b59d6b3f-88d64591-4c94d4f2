import { ShieldCheck, Lock } from "lucide-react";
import { tu } from "@/lib/i18n";

export function PaymentSecurityBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-xs text-muted-foreground ${className}`}
      aria-label={tu("op.payment_security")}
    >
      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
      <span>{tu("op.secure_payment_gateway")}</span>
      <span className="opacity-40">·</span>
      <Lock className="h-3 w-3" aria-hidden />
      <span>{tu("op.payment_details_handled_by_razorpay")}</span>
    </div>
  );
}
