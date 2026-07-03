import type { ReactNode } from "react";

/** Sidebar + topbar shell for Super Admin and Society Admin panels. */
export function AdminLayout({
  sidebar,
  topbar,
  children,
}: {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh flex bg-background text-foreground">
      <aside className="hidden md:flex w-64 border-r border-border flex-col">
        {sidebar}
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center px-4">
          {topbar}
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
