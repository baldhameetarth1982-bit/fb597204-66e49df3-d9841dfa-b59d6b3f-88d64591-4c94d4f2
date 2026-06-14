import type { ReactNode } from "react";
import { Logo } from "@/components/shared/Logo";

/** Minimal centered shell for /login, /forgot-password, /reset-password. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-secondary/40 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center justify-center gap-3">
          <Logo size={56} />
          <span className="text-xl font-semibold tracking-tight">SocioHub</span>
        </div>
        <div className="rounded-2xl border border-border bg-background shadow-sm p-6 md:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Society management, simplified.
        </p>
      </div>
    </div>
  );
}
