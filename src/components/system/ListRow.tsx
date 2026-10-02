import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  as?: "button" | "div";
  className?: string;
}

/**
 * Uniform list row with 56dp minimum height, leading/title/subtitle/trailing
 * slots. Ripple + focus ring apply automatically when interactive.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  as,
  className,
}: ListRowProps) {
  const interactive = Boolean(onClick);
  const Comp: any = as ?? (interactive ? "button" : "div");
  return (
    <Comp
      type={Comp === "button" ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-3 px-4 py-3 min-h-14 rounded-xl",
        "bg-card text-card-foreground border border-border/70",
        interactive && "ripple hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate type-title text-[0.95rem]">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        )}
      </div>
      {trailing && <div className="shrink-0 flex items-center gap-2">{trailing}</div>}
    </Comp>
  );
}
