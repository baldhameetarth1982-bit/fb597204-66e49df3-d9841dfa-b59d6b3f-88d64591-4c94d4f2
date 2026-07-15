import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HeroVariant = "teal" | "navy" | "muted";

const variants: Record<HeroVariant, string> = {
  teal: "bg-gradient-to-br from-primary via-primary to-[oklch(0.42_0.09_205)] text-primary-foreground",
  navy: "bg-gradient-to-br from-[oklch(0.28_0.06_255)] via-[oklch(0.22_0.05_260)] to-[oklch(0.18_0.04_260)] text-white",
  muted: "bg-gradient-to-br from-muted via-background to-muted text-foreground",
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
        "relative px-5 pt-8 pb-10 rounded-b-[32px] shadow-[0_20px_40px_-24px_rgba(0,0,0,0.35)]",
        variants[variant],
        className,
      )}
    >
      <div className="relative z-10 max-w-3xl">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0 flex items-start gap-3">
            {Icon && (
              <div className="shrink-0 h-11 w-11 rounded-2xl bg-white/15 backdrop-blur-sm grid place-items-center">
                <Icon className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">
                  {eyebrow}
                </p>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
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
