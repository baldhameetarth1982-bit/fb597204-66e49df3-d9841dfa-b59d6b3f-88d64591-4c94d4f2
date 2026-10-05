import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FinanceFilters { from: string; to: string; category: string; status: string }
export const EMPTY_FILTERS: FinanceFilters = { from: "", to: "", category: "all", status: "all" };
export const activeFilterCount = (f: FinanceFilters) =>
  [f.from, f.to, f.category !== "all", f.status !== "all"].filter(Boolean).length;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function presets() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [
    { label: "ff.thisMonth", from: ymd(monthStart), to: ymd(now) },
    { label: "ff.lastMonth", from: ymd(lastStart), to: ymd(lastEnd) },
    { label: "ff.thisFy", from: `${fyYear}-04-01`, to: ymd(now) },
  ];
}

export function FinanceFilterBar({ value, onChange, categories, statuses }: {
  value: FinanceFilters;
  onChange: (f: FinanceFilters) => void;
  categories?: readonly string[];
  statuses: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const count = activeFilterCount(value);
  const rangeInvalid = !!value.from && !!value.to && value.from > value.to;
  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {presets().map((p) => {
          const on = value.from === p.from && value.to === p.to;
          return (
            <button key={p.label} type="button" aria-pressed={on}
              onClick={() => onChange({ ...value, from: on ? "" : p.from, to: on ? "" : p.to })}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
              {t(p.label)}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="grid gap-1"><Label htmlFor="ff-from" className="text-xs">{t("common.from")}</Label>
          <Input id="ff-from" type="date" className="h-11" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor="ff-to" className="text-xs">{t("common.to")}</Label>
          <Input id="ff-to" type="date" className="h-11" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>
        {categories && (
          <div className="grid gap-1"><Label className="text-xs">{t("common.category")}</Label>
            <Select value={value.category} onValueChange={(v) => onChange({ ...value, category: v })}>
              <SelectTrigger aria-label={t("common.category")} className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ff.allCategories")}</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{t(`vch.kind.${c}`, { defaultValue: c })}</SelectItem>)}
              </SelectContent>
            </Select></div>
        )}
        <div className="grid gap-1"><Label className="text-xs">{t("common.status")}</Label>
          <Select value={value.status} onValueChange={(v) => onChange({ ...value, status: v })}>
            <SelectTrigger aria-label={t("common.status")} className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("ff.allStatuses")}</SelectItem>
              {statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select></div>
      </div>
      {rangeInvalid && <p className="text-xs text-destructive">{t("ff.rangeInvalid")}</p>}
      {count > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">{t("ff.applied", { count })}</span>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange(EMPTY_FILTERS)}><X className="h-3.5 w-3.5 mr-1" />{t("exp.clearFilters")}</Button>
        </div>
      )}
    </div>
  );
}
