import { Info, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  amount: number;
  platformFeePct?: number; // default 1.5
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/**
 * Tiny "i" icon next to a payment amount that opens a transparent fee breakdown.
 */
export function FeeBreakdown({ amount, platformFeePct = 1.5 }: Props) {
  const fee = (amount * platformFeePct) / 100;
  const society = amount - fee;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Fee breakdown"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 rounded-2xl p-4" side="top" align="end">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-success" />
          <p className="text-xs font-semibold uppercase tracking-wide text-success">Transparent breakdown</p>
        </div>
        <p className="text-sm font-semibold">{fmt.format(amount)}</p>
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Society Fund ({(100 - platformFeePct).toFixed(1)}%)</span>
            <span className="font-semibold tabular-nums">{fmt.format(society)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Platform Fee ({platformFeePct.toFixed(1)}%)</span>
            <span className="font-semibold tabular-nums">{fmt.format(fee)}</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden mt-2">
            <div className="h-full bg-success rounded-full" style={{ width: `${100 - platformFeePct}%` }} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
