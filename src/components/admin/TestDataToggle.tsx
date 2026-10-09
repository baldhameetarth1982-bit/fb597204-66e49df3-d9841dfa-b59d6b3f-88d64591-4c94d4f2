import { FlaskConical } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/** "Show test data" switch for Super Admin lists. Hidden rows are only hidden, never removed. */
export function TestDataToggle({ show, onChange, hiddenCount }: { show: boolean; onChange: (v: boolean) => void; hiddenCount: number }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <FlaskConical className="h-4 w-4" aria-hidden />
        {show ? "Showing test and demo records" : hiddenCount > 0 ? `${hiddenCount} test or demo record(s) hidden` : "No test or demo records"}
      </span>
      <label className="flex items-center gap-2 font-medium">
        Show test data
        <Switch checked={show} onCheckedChange={onChange} aria-label="Show test data" />
      </label>
    </div>
  );
}
