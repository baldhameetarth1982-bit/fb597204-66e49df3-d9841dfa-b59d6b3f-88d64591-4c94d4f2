import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Search, Star, Clock, Lock, ChevronRight, X, LayoutGrid,
  Activity, Building2, Building, Home, Users, Receipt, TrendingDown,
  BookOpen, Wallet, BarChart3, UsersRound, Car, Sparkles, UserCheck,
  ShieldCheck, MessageSquare, FileCheck2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  CATEGORY_LABELS,
  PLAN_LABELS,
  getFeatureCatalog,
  type AppRole,
  type FeatureCatalogEntry,
  type FeatureCategory,
} from "@/lib/plan-features";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, any> = {
  Activity, Building2, Building, Home, Users, Receipt, TrendingDown, BookOpen,
  Wallet, BarChart3, UsersRound, Car, Sparkles, UserCheck, ShieldCheck,
  MessageSquare, LayoutGrid, FileCheck2,
};

const FAVORITES_KEY_PREFIX = "sociohub:feature-favorites:";
const RECENT_KEY_PREFIX = "sociohub:feature-recent:";

function useLocalList(storageKey: string, cap = 8) {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setItems(JSON.parse(raw) as string[]);
    } catch {}
  }, [storageKey]);

  const persist = (next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  };

  return {
    items,
    toggle: (key: string) => {
      const next = items.includes(key) ? items.filter((k) => k !== key) : [key, ...items].slice(0, cap);
      persist(next);
    },
    push: (key: string) => {
      const next = [key, ...items.filter((k) => k !== key)].slice(0, cap);
      persist(next);
    },
    has: (key: string) => items.includes(key),
  };
}

interface Props {
  /** Which role's features to show. */
  role: AppRole;
}

/**
 * Feature Directory — powered entirely by the central catalog in
 * `src/lib/plan-features.ts`. No duplicate arrays. Same source used by
 * FeatureGate, UpgradePrompt, and navigation.
 */
export function FeatureDirectory({ role }: Props) {
  const { plan, hasFeature } = useFeatureAccess();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FeatureCategory | "all">("all");

  const favorites = useLocalList(`${FAVORITES_KEY_PREFIX}${role}`, 12);
  const recent = useLocalList(`${RECENT_KEY_PREFIX}${role}`, 8);

  const catalog = useMemo(() => getFeatureCatalog().filter((f) => f.roles.includes(role)), [role]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((f) => {
      if (activeCategory !== "all" && f.category !== activeCategory) return false;
      if (!q) return true;
      const hay = [
        f.label,
        f.shortDescription,
        f.category,
        f.navigationGroup,
        ...f.keywords,
        f.route ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, query, activeCategory]);

  const categories = useMemo(() => {
    const set = new Set<FeatureCategory>();
    catalog.forEach((f) => set.add(f.category));
    return Array.from(set);
  }, [catalog]);

  const favoriteEntries = catalog.filter((f) => favorites.has(f.key));
  const recentEntries = recent.items
    .map((k) => catalog.find((f) => f.key === k))
    .filter(Boolean) as FeatureCatalogEntry[];

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Discover"
        title="Feature Directory"
        subtitle={`${catalog.length} features · your plan: ${PLAN_LABELS[plan]}`}
        icon={LayoutGrid}
        variant="teal"
      />

      <div className="px-4 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search features, keywords, or routes…"
            className="pl-9 pr-9 rounded-xl h-11"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Category chips */}
        <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 min-w-max">
            <CategoryChip
              label="All"
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {categories.map((cat) => (
              <CategoryChip
                key={cat}
                label={CATEGORY_LABELS[cat]}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
              />
            ))}
          </div>
        </div>

        {/* Favorites */}
        {activeCategory === "all" && !query && favoriteEntries.length > 0 && (
          <SectionCard title="Favorites" description={`${favoriteEntries.length} pinned`}>
            <FeatureList
              entries={favoriteEntries}
              hasFeature={hasFeature}
              onOpen={(key) => recent.push(key)}
              onToggleFav={favorites.toggle}
              isFav={favorites.has}
            />
          </SectionCard>
        )}

        {/* Recently used */}
        {activeCategory === "all" && !query && recentEntries.length > 0 && (
          <SectionCard title="Recently used" description="Your last opened features">
            <FeatureList
              entries={recentEntries}
              hasFeature={hasFeature}
              onOpen={(key) => recent.push(key)}
              onToggleFav={favorites.toggle}
              isFav={favorites.has}
            />
          </SectionCard>
        )}

        {/* Main list */}
        {filtered.length === 0 ? (
          <SectionCard title="No results">
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nothing matches "{query}". Try a different keyword.
            </p>
          </SectionCard>
        ) : activeCategory === "all" ? (
          categories.map((cat) => {
            const rows = filtered.filter((f) => f.category === cat);
            if (rows.length === 0) return null;
            return (
              <SectionCard key={cat} title={CATEGORY_LABELS[cat]} description={`${rows.length} features`}>
                <FeatureList
                  entries={rows}
                  hasFeature={hasFeature}
                  onOpen={(key) => recent.push(key)}
                  onToggleFav={favorites.toggle}
                  isFav={favorites.has}
                />
              </SectionCard>
            );
          })
        ) : (
          <SectionCard
            title={CATEGORY_LABELS[activeCategory]}
            description={`${filtered.length} features`}
          >
            <FeatureList
              entries={filtered}
              hasFeature={hasFeature}
              onOpen={(key) => recent.push(key)}
              onToggleFav={favorites.toggle}
              isFav={favorites.has}
            />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 h-8 px-3 rounded-full text-xs font-medium border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card text-foreground border-border hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}

function FeatureList({
  entries,
  hasFeature,
  onOpen,
  onToggleFav,
  isFav,
}: {
  entries: FeatureCatalogEntry[];
  hasFeature: (key: string) => boolean;
  onOpen: (key: string) => void;
  onToggleFav: (key: string) => void;
  isFav: (key: string) => boolean;
}) {
  return (
    <ul className="divide-y">
      {entries.map((f) => (
        <FeatureRow
          key={f.key}
          entry={f}
          unlocked={hasFeature(f.key)}
          onOpen={() => onOpen(f.key)}
          onToggleFav={() => onToggleFav(f.key)}
          fav={isFav(f.key)}
        />
      ))}
    </ul>
  );
}

function FeatureRow({
  entry,
  unlocked,
  onOpen,
  onToggleFav,
  fav,
}: {
  entry: FeatureCatalogEntry;
  unlocked: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
  fav: boolean;
}) {
  const Icon = ICON_MAP[entry.icon] ?? LayoutGrid;
  const isPlanned = entry.status === "planned";
  // Planned features: honest non-clickable status.
  // Locked features: route to plan-required. Available features: route to real destination.
  const target = isPlanned
    ? null
    : unlocked && entry.route
    ? entry.route
    : "/society/plan-required";

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 shrink-0 rounded-2xl grid place-items-center",
            unlocked && !isPlanned ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{entry.label}</p>
            {!unlocked && !isPlanned && (
              <Badge variant="secondary" className="rounded-full h-4 px-1.5 text-[10px] gap-0.5">
                <Lock className="h-2.5 w-2.5" />
                {PLAN_LABELS[entry.minPlan]}
              </Badge>
            )}
            {isPlanned && (
              <Badge variant="outline" className="rounded-full h-4 px-1.5 text-[10px]">
                Planned
              </Badge>
            )}
            {entry.status === "partial" && unlocked && (
              <Badge
                variant="outline"
                className="rounded-full h-4 px-1.5 text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20"
              >
                Partial
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{entry.shortDescription}</p>
        </div>

        <button
          type="button"
          aria-label={fav ? "Unpin" : "Pin"}
          onClick={onToggleFav}
          className="shrink-0 p-2 text-muted-foreground hover:text-amber-500"
        >
          <Star className={cn("h-4 w-4", fav && "fill-amber-500 text-amber-500")} />
        </button>

        {target ? (
          <Button asChild size="sm" variant="ghost" className="rounded-xl shrink-0 h-8 px-2">
            <Link to={target as any} onClick={onOpen}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <div className="shrink-0 h-8 w-8 grid place-items-center text-muted-foreground">
            <Clock className="h-4 w-4" />
          </div>
        )}
      </div>
    </li>
  );
}
