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
        "rounded-2xl bg-white/12 backdrop-blur-sm px-3 py-2.5 min-w-0",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
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
