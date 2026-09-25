import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shared "People & property" area navigation — only existing routes. */
const AREA = [
  { to: "/society/residents", label: "Residents" },
  { to: "/society/flats", label: "Houses" },
  { to: "/society/vehicles", label: "Vehicles" },
  { to: "/society/parking", label: "Parking" },
] as const;

export function PeopleAreaNav() {
  return (
    <nav aria-label="People and property" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1">
      {AREA.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          activeProps={{ className: "bg-primary-container text-primary-container-foreground", "aria-current": "page" }}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "info" | "muted";
const TONES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  primary: "bg-primary-container text-primary-container-foreground",
  success: "bg-success-container text-success-container-foreground",
  warning: "bg-warning-container text-warning-container-foreground",
  info: "bg-info-container text-info-container-foreground",
  muted: "bg-muted text-muted-foreground",
};

export function StatusChip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

/** Summary strip: figures separated by hairlines; "—" when unknown. */
export function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode; hint?: string }> }) {
  return (
    <dl className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-border gap-px sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums">{i.value}</dd>
          {i.hint && <p className="text-xs text-muted-foreground">{i.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border rounded-2xl border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InlineNotice({ icon: Icon, title, children, action }: {
  icon: ComponentType<{ className?: string }>; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-warning-container px-4 py-3 text-warning-container-foreground sm:flex-row sm:items-center">
      <Icon className="hidden h-5 w-5 shrink-0 sm:block" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        {children && <p className="opacity-80">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/** Compact search field shared across People & property pages. */
export function SearchField({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

/** Segmented filter: single-select pills with counts. */
export function SegmentedFilter<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; label: string;
  options: Array<{ key: K; label: string; count?: number }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && <span className="tabular-nums opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Failure block — never looks like an empty dataset. */
export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Retry
      </button>
    </div>
  );
}

/** Quiet empty / no-results block used inside list regions. */
export function ListEmpty({ icon: Icon, title, children }: { icon: ComponentType<{ className?: string }>; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
