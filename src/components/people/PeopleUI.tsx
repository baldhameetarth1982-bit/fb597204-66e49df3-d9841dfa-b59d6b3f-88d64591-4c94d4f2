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
