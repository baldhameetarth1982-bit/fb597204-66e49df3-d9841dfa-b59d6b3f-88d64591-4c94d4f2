import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page wrapper for the mobile-first app.
 * Applies safe-area padding, consistent spacing, and scales to a comfortable
 * reading column on desktop without forcing a desktop-only layout.
 */
export function MobileScreen({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        padded && "px-4 pt-4 pb-8",
        className,
      )}
      style={{
        paddingBottom: padded ? "max(2rem, env(safe-area-inset-bottom))" : undefined,
      }}
    >
      {children}
    </div>
  );
}
