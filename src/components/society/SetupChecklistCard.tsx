/**
 * Stage 2E — Society Admin setup checklist card.
 *
 * Reads server-derived state via `getSetupChecklist` (which wraps the
 * `migration_setup_checklist` RPC). No localStorage, no fake ticks.
 * Import remains optional — a missing import never blocks setup completion.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, AlertTriangle, ArrowRight, ListChecks, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getSetupChecklist } from "@/lib/migration.functions";

type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  to?: string;
  optional?: boolean;
  hint?: string;
};

export function SetupChecklistCard({ societyId }: { societyId: string }) {
  const fetchChecklist = useServerFn(getSetupChecklist);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["society-setup-checklist", societyId],
    queryFn: () => fetchChecklist({ data: { society_id: societyId } }),
    enabled: !!societyId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading setup checklist…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    // Fail closed: never fake completion when the server call fails or the
    // caller is denied (unavailable → thrown as MigrationError).
    return (
      <Card className="rounded-2xl border-warning/30 bg-warning/5">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" /> Setup checklist unavailable.
        </CardContent>
      </Card>
    );
  }

  const items: ChecklistItem[] = [
    {
      key: "profile",
      label: "Society profile",
      done: true, // presence of a societyId implies the profile exists
      to: "/society/business-profile",
      hint: "Business details, address and branding.",
    },
    {
      key: "structure",
      label: "Structure configured",
      done: data.has_blocks || data.has_flats, // structured OR serial
      to: "/society/blocks",
      hint: "Blocks / wings or serial-mode units.",
    },
    {
      key: "units",
      label: "Active units exist",
      done: data.has_flats,
      to: "/society/flats",
      hint: `${data.flats} unit${data.flats === 1 ? "" : "s"} configured.`,
    },
    {
      key: "admin",
      label: "Society admin active",
      done: true, // guarded by RLS: getSetupChecklist requires admin scope
      to: "/society/team",
      hint: "You are signed in as an active admin.",
    },
    {
      key: "team",
      label: "Team & roles reviewed",
      done: false,
      to: "/society/team",
      hint: "Review scopes for block admins and helpers.",
    },
    {
      key: "privacy",
      label: "Privacy & finance visibility reviewed",
      done: false,
      to: "/society/settings",
      hint: "Confirm what residents can see.",
    },
    {
      key: "residents",
      label: "Residents onboarded",
      done: data.has_residents,
      to: "/society/residents",
      hint: `${data.active_residents} active resident${data.active_residents === 1 ? "" : "s"}.`,
    },
    {
      key: "import",
      label: "Bulk import (optional)",
      done: data.has_completed_imports,
      to: "/society/import",
      optional: true,
      hint: data.has_completed_imports
        ? `${data.completed_imports} completed import${data.completed_imports === 1 ? "" : "s"}.`
        : "CSV migration is optional — skip if not needed.",
    },
  ];

  const required = items.filter((i) => !i.optional);
  const doneCount = required.filter((i) => i.done).length;
  const complete = doneCount === required.length;

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Society setup</p>
            <p className="text-[11px] text-muted-foreground">
              {complete
                ? "All required steps complete."
                : `${doneCount} of ${required.length} required steps done`}
            </p>
          </div>
        </div>
        <ul className="space-y-1.5" data-testid="setup-checklist">
          {items.map((it) => (
            <li key={it.key}>
              <Link
                to={it.to as any}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/60 transition"
              >
                {it.done ? (
                  <Check className="h-4 w-4 text-success shrink-0" aria-label="done" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" aria-label="pending" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {it.label}
                    {it.optional && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(optional)</span>
                    )}
                  </p>
                  {it.hint && (
                    <p className="text-[11px] text-muted-foreground truncate">{it.hint}</p>
                  )}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
