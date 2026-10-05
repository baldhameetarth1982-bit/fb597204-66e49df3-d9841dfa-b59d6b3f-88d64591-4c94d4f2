import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { toast } from "sonner";
import { SUPPORTED_LANGS, setLanguage } from "@/lib/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The one language picker (English / Gujarati / Hindi). Choice is per device, per user. */
export function LanguageSelector({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.language?.slice(0, 2) ?? "en") as "en" | "hi" | "gu";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t("common.language")}
        </span>
      )}
      <Select
        value={current}
        onValueChange={(v) => {
          if (v === current) return;
          setLanguage(v as "en" | "hi" | "gu");
          toast.success(t("language.updated", { lng: v }));
        }}
      >
        <SelectTrigger className="min-h-11 w-[180px] text-sm" aria-label={t("common.language")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGS.map((l) => (
            <SelectItem key={l.code} value={l.code} className="min-h-11 text-sm">
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
