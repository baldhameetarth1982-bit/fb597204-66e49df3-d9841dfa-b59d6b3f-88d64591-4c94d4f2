import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Plus, Pencil } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";

import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
    <FeatureGate feature="non_member_payments">
      <CategoriesPage />
    </FeatureGate>
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

function CategoriesPage() {
  const { societyId, loading } = useSocietyId();
  const qc = useQueryClient();
  const listFn = useServerFn(listIncomeCategoriesFn);
  const createFn = useServerFn(createIncomeCategoryFn);
  const updateFn = useServerFn(updateIncomeCategoryFn);

  const listQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "categories", societyId],
    queryFn: async () => listFn({ data: { societyId: societyId! } }),
  });

  const [editing, setEditing] = useState<Editing>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["society-income", "categories", societyId] });

  const createMut = useMutation({
    mutationFn: async (v: {
      key: string;
      display_name: string;
      description?: string;
      category_group?: string;
    }) => createFn({ data: { societyId: societyId!, ...v } }),
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
    }) => updateFn({ data: { societyId: societyId!, ...v } }),
    onSuccess: () => {
      toast.success("Category updated");
      setEditing(null);
      void invalidate();
    },
    onError: () => toast.error("Could not update category"),
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const items = (listQ.data?.items ?? []) as CategoryItem[];

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income
      </Link>
      <MobileHero
        title="Income Categories"
        subtitle="Organize where your society's income comes from."
      />

      <div className="flex justify-end">
        <Button
          className="min-h-[44px]"
          onClick={() => setEditing({ mode: "create" })}
        >
          <Plus className="h-4 w-4 mr-1" /> New category
        </Button>
      </div>

      <SectionCard title="Categories" description="Deactivate a category to hide it from new records.">
        {listQ.isError ? (
          <div className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Categories are temporarily unavailable.
          </div>
        ) : listQ.isLoading ? (
          <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No categories yet. Create your first one.
          </div>
        ) : (
          <div className="divide-y">
            {items.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 py-3 px-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {c.display_name}
                    {c.is_system && (
                      <Badge variant="outline" className="text-[10px]">System</Badge>
                    )}
                    {!c.is_active && (
                      <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.key}
                    {c.category_group ? ` · ${c.category_group}` : ""}
                    {c.description ? ` · ${c.description}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setEditing({ mode: "edit", row: c })}
                  aria-label={`Edit ${c.display_name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

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

  // Reset form when the dialog opens or switches target.
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
      if (!key.trim()) return;
      onCreate({
        key: key.trim(),
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        category_group: group.trim() || undefined,
      });
    }
  };

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update details or deactivate this category."
              : "Give this income source a short key and display name."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit && (
            <div>
              <Label htmlFor="cat-key" className="text-xs">Key</Label>
              <Input
                id="cat-key"
                className="min-h-[44px]"
                placeholder="hall_rent"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoCapitalize="none"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Lowercase letters, numbers, underscore or dash. Cannot be changed later.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="cat-name" className="text-xs">Display name</Label>
            <Input
              id="cat-name"
              className="min-h-[44px]"
              placeholder="Hall Rent"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cat-group" className="text-xs">Group (optional)</Label>
            <Input
              id="cat-group"
              className="min-h-[44px]"
              placeholder="Facilities"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cat-desc" className="text-xs">Description (optional)</Label>
            <Textarea
              id="cat-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px]"
            onClick={submit}
            disabled={submitting || !displayName.trim() || (!isEdit && !key.trim())}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isEdit ? (
              "Save"
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
