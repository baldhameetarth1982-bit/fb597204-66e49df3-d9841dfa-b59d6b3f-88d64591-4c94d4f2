import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared communication patterns (notices, notifications, requests, visitors).
 *  Builds on People UI primitives (StatusChip, SearchField, LoadError...). */

export function CommPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12", wide ? "max-w-5xl" : "max-w-3xl")}>
      {children}
    </div>
  );
}

export function CommHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="mb-2 mt-6 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
      {count != null && <span className="rounded-full bg-muted px-1.5 tabular-nums">{count}</span>}
    </h2>
  );
}

type Edge = "none" | "primary" | "danger" | "warning" | "success";
const EDGE: Record<Edge, string> = {
  none: "before:bg-transparent",
  primary: "before:bg-primary",
  danger: "before:bg-destructive",
  warning: "before:bg-warning",
  success: "before:bg-success",
};

/** One scannable row: leading icon, title, meta line, trailing slot, coloured edge. */
export function CommRow({ icon: Icon, iconTone = "default", title, meta, body, trailing, edge = "none", unread, onClick, className }: {
  icon?: ComponentType<{ className?: string }>;
  iconTone?: "default" | "danger";
  title: ReactNode; meta?: ReactNode; body?: ReactNode; trailing?: ReactNode;
  edge?: Edge; unread?: boolean; onClick?: () => void; className?: string;
}) {
  const inner = (
    <>
      {Icon && (
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full",
          iconTone === "danger" ? "bg-destructive text-destructive-foreground" : "bg-muted text-foreground")}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {meta && <span className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{meta}</span>}
        <span className={cn("block text-sm leading-snug", unread ? "font-semibold" : "font-medium")}>{title}</span>
        {body && <span className="mt-0.5 block text-sm text-muted-foreground line-clamp-2">{body}</span>}
      </span>
      {trailing}
      {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </>
  );
  const cls = cn(
    "relative flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r",
    EDGE[edge],
    onClick && "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    className,
  );
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** Hairline-divided list container for CommRow. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {children}
    </ul>
  );
}
