import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Search,
  Tags,
  ShieldCheck,
  Sparkles,
  Layers,
  RotateCcw,
} from "lucide-react";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { incomeKeys, incomeInvalidations } from "@/lib/income-query-keys";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listIncomeCategoriesFn,
  createIncomeCategoryFn,
  updateIncomeCategoryFn,
} from "@/lib/non-member-income.functions";

export const Route = createFileRoute("/_society/society/income/categories")({
  head: () => ({
    meta: [
      { title: "Income Categories — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <IncomeAccessBoundary>
      {(societyId) => <CategoriesPage societyId={societyId} />}
    </IncomeAccessBoundary>
  ),
});

interface CategoryItem {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  category_group: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; row: CategoryItem }
  | null;

type StatusFilter = "all" | "active" | "inactive";
type KindFilter = "all" | "system" | "custom";

/** Normalize a candidate category key to the server's accepted shape. */
function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Deterministic pastel tile per category, for a calm palette. */
const TILES = [
  "bg-[#E6F7F4] text-[#007E70]",
  "bg-[#EEF4FF] text-[#3155D4]",
  "bg-[#FFF4E6] text-[#B45309]",
  "bg-[#FDECEF] text-[#B42318]",
  "bg-[#F1ECFB] text-[#6E3AD1]",
  "bg-[#E8F5EE] text-[#12B76A]",
];
function tileFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length];
}

function SummaryCard({
  label,
  value,
  tint,
  icon: Icon,
}: {
  label: string;
  value: number;
  tint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[18px] bg-white border border-[#DDE9E6] p-4 shadow-[0_2px_8px_-4px_rgba(11,37,69,0.08)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#667085]">{label}</span>
        <span
          className={`h-8 w-8 rounded-xl grid place-items-center ${tint}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-[#0B2545]">
        {value}
      </div>
    </div>
  );
}

function CategoriesPage({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listIncomeCategoriesFn);
  const createFn = useServerFn(createIncomeCategoryFn);
  const updateFn = useServerFn(updateIncomeCategoryFn);

  const listQ = useQuery({
    queryKey: incomeKeys.categories(societyId),
    queryFn: async () => listFn({ data: { societyId } }),
  });

  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [group, setGroup] = useState<string>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const invalidate = () => {
    for (const key of incomeInvalidations.category(societyId)) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const createMut = useMutation({
    mutationFn: async (v: {
      key: string;
      display_name: string;
      description?: string;
      category_group?: string;
    }) => createFn({ data: { societyId, ...v } }),
    onSuccess: () => {
      toast.success("Category created");
      setEditing(null);
      void invalidate();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "create_failed";
      toast.error(
        msg === "duplicate_category_key"
          ? "A category with this key already exists"
          : "Could not create category",
      );
    },
  });

  const updateMut = useMutation({
    mutationFn: async (v: {
      id: string;
      display_name?: string;
      description?: string;
      category_group?: string;
      is_active?: boolean;
    }) => updateFn({ data: { societyId, ...v } }),
    onSuccess: () => {
      toast.success("Category updated");
      setEditing(null);
      void invalidate();
    },
    onError: () => toast.error("Could not update category"),
  });

  const items = (listQ.data?.items ?? []) as CategoryItem[];

  const summary = useMemo(
    () => ({
      total: items.length,
      active: items.filter((i) => i.is_active).length,
      system: items.filter((i) => i.is_system).length,
      custom: items.filter((i) => !i.is_system).length,
    }),
    [items],
  );

  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) if (i.category_group) s.add(i.category_group);
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (status === "active" && !c.is_active) return false;
      if (status === "inactive" && c.is_active) return false;
      if (kind === "system" && !c.is_system) return false;
      if (kind === "custom" && c.is_system) return false;
      if (group !== "all" && (c.category_group ?? "") !== group) return false;
      if (debounced) {
        const hay =
          `${c.display_name} ${c.key} ${c.description ?? ""} ${c.category_group ?? ""}`.toLowerCase();
        if (!hay.includes(debounced)) return false;
      }
      return true;
    });
  }, [items, status, kind, group, debounced]);

  const resetFilters = () => {
    setSearch("");
    setStatus("all");
    setKind("all");
    setGroup("all");
  };

  const filtersActive =
    !!debounced || status !== "all" || kind !== "all" || group !== "all";

  return (
    <div className="min-h-screen bg-[#F6F8F7]">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <Link
          to="/society/income"
          className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B2545] min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Income
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#0B2545]">
              Income Categories
            </h1>
            <p className="text-sm text-[#667085] mt-1">
              Organize where your society's income comes from.
            </p>
          </div>
          <Button
            className="min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white shadow-[0_6px_16px_-6px_rgba(0,168,150,0.55)]"
            onClick={() => setEditing({ mode: "create" })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Category
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total" value={summary.total} tint="bg-[#E6F7F4] text-[#007E70]" icon={Layers} />
          <SummaryCard label="Active" value={summary.active} tint="bg-[#E8F5EE] text-[#12B76A]" icon={ShieldCheck} />
          <SummaryCard label="System" value={summary.system} tint="bg-[#EEF4FF] text-[#3155D4]" icon={Tags} />
          <SummaryCard label="Custom" value={summary.custom} tint="bg-[#F1ECFB] text-[#6E3AD1]" icon={Sparkles} />
        </div>

        <div className="rounded-[18px] bg-white border border-[#DDE9E6] p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667085]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories"
              className="pl-9 min-h-[44px] rounded-[14px] border-[#DDE9E6] bg-white"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="min-h-[44px] w-[130px] rounded-[14px] border-[#DDE9E6]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
            <SelectTrigger className="min-h-[44px] w-[130px] rounded-[14px] border-[#DDE9E6]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {groups.length > 0 && (
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="min-h-[44px] w-[150px] rounded-[14px] border-[#DDE9E6]">
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtersActive && (
            <Button
              variant="outline"
              className="min-h-[44px] rounded-[14px] border-[#DDE9E6] text-[#667085]"
              onClick={resetFilters}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
          )}
        </div>

        <div className="rounded-[18px] bg-white border border-[#DDE9E6] overflow-hidden">
          {listQ.isError ? (
            <div className="p-6 text-sm text-[#F04438] flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Categories are temporarily unavailable.
            </div>
          ) : listQ.isLoading ? (
            <div className="divide-y divide-[#DDE9E6]">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="p-4 flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-9 w-9 rounded-xl" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-[#E6F7F4] text-[#007E70] grid place-items-center">
                <Tags className="h-5 w-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-[#0B2545]">
                No categories yet
              </div>
              <p className="text-xs text-[#667085] mt-1">
                Create your first income category to start categorizing collections.
              </p>
              <Button
                className="mt-4 min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white"
                onClick={() => setEditing({ mode: "create" })}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Category
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-sm font-medium text-[#0B2545]">No matches</div>
              <p className="text-xs text-[#667085] mt-1">
                Try clearing filters or a different search term.
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                onClick={resetFilters}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-[#DDE9E6]">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-4"
                >
                  <div
                    className={`shrink-0 h-11 w-11 rounded-2xl grid place-items-center ${tileFor(c.id)}`}
                  >
                    <Tags className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#0B2545] truncate flex items-center gap-2">
                      {c.display_name}
                      {c.is_system ? (
                        <Badge className="text-[10px] bg-[#EEF4FF] text-[#3155D4] border-transparent">
                          System
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-[#F1ECFB] text-[#6E3AD1] border-transparent">
                          Custom
                        </Badge>
                      )}
                      {c.is_active ? (
                        <Badge className="text-[10px] bg-[#E8F5EE] text-[#12B76A] border-transparent">
                          Active
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-[#FEF3F2] text-[#B42318] border-transparent">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-[#667085] truncate mt-0.5">
                      <span className="font-mono">{c.key}</span>
                      {c.category_group ? ` · ${c.category_group}` : ""}
                      {c.description ? ` · ${c.description}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!c.is_system && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] rounded-[14px] border-[#DDE9E6] text-[#667085]"
                        onClick={() =>
                          updateMut.mutate({
                            id: c.id,
                            is_active: !c.is_active,
                          })
                        }
                        disabled={updateMut.isPending}
                      >
                        {c.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                      onClick={() => setEditing({ mode: "edit", row: c })}
                      aria-label={`Edit ${c.display_name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CategoryDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onCreate={(v) => createMut.mutate(v)}
        onUpdate={(v) => updateMut.mutate(v)}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}

function CategoryDialog(props: {
  editing: Editing;
  onClose: () => void;
  onCreate: (v: {
    key: string;
    display_name: string;
    description?: string;
    category_group?: string;
  }) => void;
  onUpdate: (v: {
    id: string;
    display_name?: string;
    description?: string;
    category_group?: string;
    is_active?: boolean;
  }) => void;
  submitting: boolean;
}) {
  const { editing, onClose, onCreate, onUpdate, submitting } = props;
  const isEdit = editing?.mode === "edit";
  const row = editing?.mode === "edit" ? editing.row : null;

  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [active, setActive] = useState(true);

  const openKey = editing ? (isEdit ? row!.id : "new") : "closed";
  useEffect(() => {
    if (isEdit && row) {
      setKey(row.key);
      setDisplayName(row.display_name);
      setDescription(row.description ?? "");
      setGroup(row.category_group ?? "");
      setActive(row.is_active);
    } else if (editing?.mode === "create") {
      setKey("");
      setDisplayName("");
      setDescription("");
      setGroup("");
      setActive(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  const normalizedKey = normalizeKey(key);
  const keyValid = !isEdit ? /^[a-z0-9][a-z0-9_-]{1,58}[a-z0-9]$/.test(normalizedKey) : true;

  const submit = () => {
    if (!displayName.trim()) return;
    if (isEdit && row) {
      onUpdate({
        id: row.id,
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        category_group: group.trim() || undefined,
        is_active: active,
      });
    } else {
      if (!keyValid) return;
      onCreate({
        key: normalizedKey,
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        category_group: group.trim() || undefined,
      });
    }
  };

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[24px] border-[#DDE9E6] bg-white/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[#0B2545]">
            {isEdit ? "Edit category" : "New category"}
          </DialogTitle>
          <DialogDescription className="text-[#667085]">
            {isEdit
              ? "Update details or deactivate this category."
              : "Give this income source a short key and display name."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit && (
            <div>
              <Label htmlFor="cat-key" className="text-xs text-[#667085]">Key</Label>
              <Input
                id="cat-key"
                className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                placeholder="hall_rent"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoCapitalize="none"
                maxLength={60}
              />
              <p className="text-[11px] text-[#667085] mt-1">
                Will be saved as{" "}
                <span className="font-mono text-[#0B2545]">
                  {normalizedKey || "…"}
                </span>
                . Cannot be changed later.
              </p>
              {key && !keyValid && (
                <p className="text-[11px] text-[#F04438] mt-1">
                  Use 3–60 characters: lowercase letters, numbers, underscore or dash.
                </p>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="cat-name" className="text-xs text-[#667085]">Display name</Label>
            <Input
              id="cat-name"
              className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
              placeholder="Hall Rent"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="cat-group" className="text-xs text-[#667085]">Group (optional)</Label>
            <Input
              id="cat-group"
              className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
              placeholder="Facilities"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="cat-desc" className="text-xs text-[#667085]">Description (optional)</Label>
            <Textarea
              id="cat-desc"
              rows={3}
              className="rounded-[14px] border-[#DDE9E6]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          {isEdit && (
            <div className="flex items-center justify-between rounded-[14px] border border-[#DDE9E6] bg-[#F6F8F7] px-3 py-2">
              <div>
                <div className="text-sm font-medium text-[#0B2545]">Active</div>
                <div className="text-[11px] text-[#667085]">
                  Inactive categories are hidden from new income entries.
                </div>
              </div>
              <Switch
                checked={active}
                onCheckedChange={setActive}
                aria-label="Active"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white"
            onClick={submit}
            disabled={
              submitting ||
              !displayName.trim() ||
              (!isEdit && !keyValid)
            }
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isEdit ? (
              "Save Category"
            ) : (
              "Create Category"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
