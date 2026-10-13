import { useId, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  CATEGORY_LABELS,
  getFeatureCatalog,
  hasFeature,
  type FeatureCatalogEntry,
  type PlanKey,
} from "@/lib/plan-features";

/** Same headline features on every plan card, so plans compare side by side. */
const HIGHLIGHT_KEYS = [
  "billing",
  "no_dues",
  "ai_secretary",
  "ai_digest",
  "accounts_center",
  "visitors",
  "guard_visitor_entry",
  "amenities",
  "community_feed",
  "advanced_automation",
  "meetings",
  "elections",
];

/** Every plan-gated feature from the Feature Directory (platform-only entries excluded). */
export function planComparableFeatures(): FeatureCatalogEntry[] {
  return getFeatureCatalog().filter((e) => !e.planNeutral);
}

export function isPlanKey(id: string): id is PlanKey {
  return id === "basic" || id === "pro" || id === "premium";
}

function Row({ entry, included }: { entry: FeatureCatalogEntry; included: boolean }) {
  return (
    <li className={`flex items-start gap-2 ${included ? "" : "text-muted-foreground"}`}>
      {included ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0 opacity-60" aria-hidden />
      )}
      <span className={included ? "" : "line-through decoration-muted-foreground/40"}>
        {entry.label}
        <span className="sr-only">{included ? " — included" : " — not included"}</span>
      </span>
    </li>
  );
}

export function PlanFeatureList({ plan, className = "" }: { plan: PlanKey; className?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const all = planComparableFeatures();
  const byKey = new Map(all.map((e) => [e.key, e]));
  const highlights = HIGHLIGHT_KEYS.map((k) => byKey.get(k)).filter(Boolean) as FeatureCatalogEntry[];
  const includedCount = all.filter((e) => hasFeature(plan, e.key)).length;

  const groups = new Map<string, FeatureCatalogEntry[]>();
  for (const e of all) {
    const g = groups.get(e.category) ?? [];
    g.push(e);
    groups.set(e.category, g);
  }

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {includedCount} of {all.length} features included
      </p>
      <ul className="space-y-2 text-sm">
        {highlights.map((e) => (
          <Row key={e.key} entry={e} included={hasFeature(plan, e.key)} />
        ))}
      </ul>
      {open && (
        <div id={listId} className="mt-4 space-y-4 border-t border-border pt-4">
          {[...groups.entries()].map(([cat, items]) => (
            <div key={cat}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
              </h4>
              <ul className="space-y-2 text-sm">
                {items.map((e) => (
                  <Row key={e.key} entry={e} included={hasFeature(plan, e.key)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((v) => !v);
        }}
        className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-full px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? "Show fewer features" : `Show all ${all.length} features`}
        <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
    </div>
  );
}
