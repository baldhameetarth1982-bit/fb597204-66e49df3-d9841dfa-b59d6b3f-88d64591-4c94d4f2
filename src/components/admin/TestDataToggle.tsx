import { FlaskConical } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

/** "Show test data" switch for Super Admin lists. Hidden rows are only hidden, never removed. */
export function TestDataToggle({ show, onChange, hiddenCount }: { show: boolean; onChange: (v: boolean) => void; hiddenCount: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <FlaskConical className="h-4 w-4" aria-hidden />
        {show ? t("ln.test.showing") : hiddenCount > 0 ? t("ln.test.hidden", { count: hiddenCount }) : t("ln.test.none")}
      </span>
      <label className="flex items-center gap-2 font-medium">
        {t("ln.test.show")}
        <Switch checked={show} onCheckedChange={onChange} aria-label={t("ln.test.show")} />
      </label>
    </div>
  );
}
