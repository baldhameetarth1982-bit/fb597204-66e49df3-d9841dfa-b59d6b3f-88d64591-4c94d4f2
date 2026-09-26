import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HeroVariant = "teal" | "navy" | "muted";

const variants: Record<HeroVariant, string> = {
  teal: "bg-primary text-primary-foreground",
  navy: "bg-foreground text-background",
  muted: "bg-secondary text-secondary-foreground",
};

/**
 * SociyoHub mobile-first hero band. Rounded bottom, gradient surface,
 * optional stat pills row and trailing action. Sits at the top of a route
 * and the page body pulls back into it with `-mt-6`.
 */
export function MobileHero({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  action,
  stats,
  variant = "teal",
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  stats?: ReactNode;
  variant?: HeroVariant;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative border-b border-border px-5 pb-8 pt-7 shadow-[var(--elevation-2)]",
        variants[variant],
        className,
      )}
    >
      <div className="relative z-10 max-w-3xl">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0 flex items-start gap-3">
            {Icon && (
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-background/15">
                <Icon className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && (
                 <p className="text-[11px] font-semibold uppercase opacity-80">
                  {eyebrow}
                </p>
              )}
               <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1 text-sm opacity-85 leading-snug">{subtitle}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {stats && <div className="mt-5">{stats}</div>}
        {children}
      </div>
    </div>
  );
}
