import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MetricItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * Grouped metrics: one labelled surface with hairline-divided tiles instead of
 * a stack of separate cards. Reads as a single unit (Gestalt common region).
 */
export function MetricGroup({
  title,
  description,
  items,
  cols = 4,
  className,
}: {
  title: string;
  description?: string;
  items: MetricItem[];
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const colCls = cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border", colCls)}>
        {items.map((m) => (
          <div key={m.label} className="min-w-0 bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {m.icon && <m.icon className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{m.label}</span>
            </div>
            <div className="mt-1.5 truncate text-xl font-semibold tabular-nums md:text-2xl">{m.value}</div>
            {m.hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{m.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Lead figure band: the one number a page is about, with supporting context. */
export function LeadFigure({
  label,
  value,
  hint,
  aside,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-3xl font-bold tabular-nums tracking-tight md:text-4xl">{value}</p>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {aside && <div className="min-w-0">{aside}</div>}
    </section>
  );
}

export function MetricsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
