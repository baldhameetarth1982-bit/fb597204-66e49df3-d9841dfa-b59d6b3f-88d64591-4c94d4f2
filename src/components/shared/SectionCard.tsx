import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Rounded card container with an optional icon header. Presentational only.
 * Body children render flush inside padded region.
 */
export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
  tone = "default",
}: {
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "default" | "primary";
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border bg-card shadow-sm overflow-hidden",
        tone === "primary" && "border-primary/30 bg-primary/5",
        className,
      )}
    >
      {(title || action) && (
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 pt-4 pb-3 border-b border-border/60">
          <div className="min-w-0 flex items-center gap-2.5">
            {Icon && (
              <div className="shrink-0 h-8 w-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
                <Icon className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-semibold tracking-tight truncate">{title}</h2>
              )}
              {description && (
                <p className="text-xs text-muted-foreground truncate">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
