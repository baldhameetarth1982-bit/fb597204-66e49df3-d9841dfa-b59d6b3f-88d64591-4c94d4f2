import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Material-3 inspired top app bar. Tall touch targets (56px), single line
 * title, optional leading + trailing slot. Sticky so content scrolls under.
 */
export function MobileTopBar({
  title,
  subtitle,
  leading,
  trailing,
  showBack = false,
  className,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  showBack?: boolean;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 h-14 border-b border-border bg-background/95 backdrop-blur",
        className,
      )}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center gap-2 px-2">
        {showBack ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => router.history.back()}
            className="h-10 w-10 rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : leading ? (
          <div className="flex h-10 w-10 items-center justify-center">{leading}</div>
        ) : (
          <div className="w-2" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {trailing && <div className="flex items-center gap-1">{trailing}</div>}
      </div>
    </header>
  );
}
