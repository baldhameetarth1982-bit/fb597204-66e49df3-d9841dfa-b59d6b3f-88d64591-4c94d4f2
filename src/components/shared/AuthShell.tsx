import type { ReactNode } from "react";
import { Logo } from "@/components/shared/Logo";
import { SociyoHubLogo } from "@/components/shared/SociyoHubLogo";

/** Minimal centered shell for /login, /forgot-password, /reset-password. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-y-0 start-0 hidden w-[34%] border-r border-border bg-secondary/45 lg:block" aria-hidden />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex flex-col items-center justify-center gap-3">
          <Logo size={52} />
          <SociyoHubLogo size={22} />
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-[var(--elevation-3)] md:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Society management, simplified.
        </p>
      </div>
    </main>
  );
}
