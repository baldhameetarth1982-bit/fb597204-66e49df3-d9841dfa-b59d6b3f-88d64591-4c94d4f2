import type { ReactNode } from "react";

/** Minimal centered shell for /login, /forgot-password, /reset-password. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-secondary/40 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground grid place-items-center font-bold">
            S
          </div>
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
