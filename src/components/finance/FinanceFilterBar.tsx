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
    { label: "This month", from: ymd(monthStart), to: ymd(now) },
    { label: "Last month", from: ymd(lastStart), to: ymd(lastEnd) },
    { label: "This FY", from: `${fyYear}-04-01`, to: ymd(now) },
  ];
}

export function FinanceFilterBar({ value, onChange, categories, statuses }: {
  value: FinanceFilters;
  onChange: (f: FinanceFilters) => void;
  categories?: readonly string[];
  statuses: { value: string; label: string }[];
}) {
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
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="grid gap-1"><Label htmlFor="ff-from" className="text-xs">From</Label>
          <Input id="ff-from" type="date" className="h-11" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></div>
        <div className="grid gap-1"><Label htmlFor="ff-to" className="text-xs">To</Label>
          <Input id="ff-to" type="date" className="h-11" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>
        {categories && (
          <div className="grid gap-1"><Label className="text-xs">Category</Label>
            <Select value={value.category} onValueChange={(v) => onChange({ ...value, category: v })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select></div>
        )}
        <div className="grid gap-1"><Label className="text-xs">Status</Label>
          <Select value={value.status} onValueChange={(v) => onChange({ ...value, status: v })}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select></div>
      </div>
      {rangeInvalid && <p className="text-xs text-destructive">"From" date must be on or before "To" date.</p>}
      {count > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">{count} filter{count === 1 ? "" : "s"} applied</span>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange(EMPTY_FILTERS)}><X className="h-3.5 w-3.5 mr-1" />Clear filters</Button>
        </div>
      )}
    </div>
  );
}
