import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Loader2, Save } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Shared page frame for every settings screen (personal + whole-society). */
export function SettingsShell({
  title, description, scope, icon: Icon, action, children,
}: {
  title: string;
  description?: string;
  scope?: "Whole society" | "Only you";
  icon?: any;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-[calc(112px+env(safe-area-inset-bottom))] md:px-6 md:pt-6 space-y-5">
      <Link
        to="/settings"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Settings
      </Link>
      <header className="flex flex-wrap items-start gap-3 border-b pb-4">
        {Icon && (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {scope && (
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{scope}</span>
            )}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="w-full sm:w-auto">{action}</div>}
      </header>
      {children}
    </main>
  );
}

export function SettingsSection({
  title, description, icon: Icon, trailing, children, id,
}: {
  title: string;
  description?: ReactNode;
  icon?: any;
  trailing?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ?? `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-primary" aria-hidden />}
        <h2 id={headingId} className="text-base font-semibold">{title}</h2>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      {description && <p className="-mt-1 mb-3 text-sm text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

/** Collapsible group for less-common settings. */
export function SettingsDisclosure({
  title, description, children, defaultOpen,
}: { title: string; description?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {description && <span className="block text-sm text-muted-foreground">{description}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="border-t px-4 pb-4 pt-3 sm:px-5">{children}</div>
    </details>
  );
}

/** Save/discard row; sticks above the bottom navigation while there are unsaved changes. */
export function SaveBar({
  dirty, saving, onSave, onDiscard, saveLabel = "Save changes", disabled,
}: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; saveLabel?: string; disabled?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 " +
        (dirty ? "sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 border-amber-500/40 shadow-lg md:bottom-4" : "")
      }
    >
      <p role="status" className="mr-auto text-sm">
        {dirty ? (
          <span className="font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>
        ) : (
          <span className="text-muted-foreground">All changes saved</span>
        )}
      </p>
      <Button variant="ghost" onClick={onDiscard} disabled={!dirty || saving} className="h-11 rounded-xl">
        Discard
      </Button>
      <Button onClick={onSave} disabled={!dirty || saving || disabled} className="h-11 rounded-xl">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {saveLabel}
      </Button>
    </div>
  );
}
