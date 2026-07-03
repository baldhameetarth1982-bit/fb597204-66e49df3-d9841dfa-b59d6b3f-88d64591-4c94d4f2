import type { ReactNode } from "react";

/**
 * Mobile-first resident shell. Safe-area padded top and bottom so
 * content never sits behind status bar, gesture bar, or bottom nav.
 */
export function ResidentLayout({
  topbar,
  bottomNav,
  children,
}: {
  topbar?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <header
        className="h-14 border-b border-border flex items-center px-4 bg-background/95 sticky top-0 z-30"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {topbar}
      </header>
      <main
        className="flex-1 p-4 overflow-auto"
        style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
      {bottomNav && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-background/95"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {bottomNav}
        </nav>
      )}
    </div>
  );
}
