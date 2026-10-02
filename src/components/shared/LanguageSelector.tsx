import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { SUPPORTED_LANGS, setLanguage } from "@/lib/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = i18n.language?.slice(0, 2) ?? "en";
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Languages className="h-3.5 w-3.5" />
          {t("common.language")}
        </span>
      )}
      <Select value={current} onValueChange={(v) => setLanguage(v as "en" | "hi" | "gu")}>
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGS.map((l) => (
            <SelectItem key={l.code} value={l.code} className="text-xs">
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
