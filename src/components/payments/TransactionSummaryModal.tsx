import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, IndianRupee } from "lucide-react";
import { PaymentSecurityBadge } from "./PaymentSecurityBadge";
import { tu } from "@/lib/i18n";

export interface TxnLine {
  label: string;
  amount: number;
  muted?: boolean;
}

export function TransactionSummaryModal({
  open,
  onOpenChange,
  title,
  description,
  lines,
  total,
  currency = "₹",
  busy,
  onConfirm,
  confirmLabel = "Pay Now",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  lines: TxnLine[];
  total: number;
  currency?: string;
  busy?: boolean;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </DialogHeader>

        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className={l.muted ? "text-muted-foreground" : ""}>{l.label}</span>
              <span className={`tabular-nums ${l.muted ? "text-muted-foreground" : ""}`}>
                {currency}
                {l.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          <div className="border-t pt-2 mt-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{tu("rbd.total")}</span>
            <span className="text-lg font-semibold tabular-nums">
              {currency}
              {total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <PaymentSecurityBadge className="mt-1" />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tu("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={busy} className="min-w-[140px]">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <IndianRupee className="h-4 w-4 mr-1" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
        <p className="text-[11px] text-muted-foreground text-center">
          {tu("op.transactions_are_final_see_our")} <a href="/refund" className="underline">{tu("op.refund_policy")}</a>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
