import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact KPI pill for hero bands. Renders on a dark/gradient surface. */
export function StatPill({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md bg-background/15 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase opacity-95">
        {Icon && <Icon className="h-3 w-3" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums truncate mt-0.5">{value}</div>
    </div>
  );
}

/** Row wrapper. 2–4 pills auto-fit on mobile without overflow. */
export function StatPillRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>;
}
