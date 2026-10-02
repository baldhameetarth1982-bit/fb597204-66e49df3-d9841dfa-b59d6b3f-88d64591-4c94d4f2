import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Flush-list row primitive. Use inside SectionCard with bodyClassName="p-0"
 * for a divided list, or standalone as a card row.
 */
export function ListCard({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  onClick,
  className,
  as = "div",
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  as?: "div" | "button";
}) {
  const Tag: any = as === "button" || onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition",
        onClick && "hover:bg-muted/50 active:bg-muted",
        className,
      )}
    >
      {leading !== undefined && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate">{title}</span>
          {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</div>
        )}
      </div>
      {trailing !== undefined && <div className="shrink-0">{trailing}</div>}
    </Tag>
  );
}

/** Divider variant of a container that holds ListCard rows. */
export function ListCardGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border/60", className)}>{children}</div>;
}
