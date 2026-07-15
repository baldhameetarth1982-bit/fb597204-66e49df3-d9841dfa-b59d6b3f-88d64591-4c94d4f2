import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ListChecks, Plus, Loader2, Trash2, GripVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/custom-fields")({
  head: () => ({ meta: [{ title: "Custom Fields — SociyoHub" }] }),
  component: CustomFieldsPage,
});

type Field = {
  id: string;
  society_id: string;
  key: string;
  label: string;
  field_type: "text" | "number" | "dropdown" | "date" | "checkbox" | "file" | "image";
  sort_order: number;
  required: boolean;
  visibility: "resident_editable" | "admin_only" | "hidden";
  options: string[] | null;
};

const TYPES: Field["field_type"][] = ["text", "number", "dropdown", "date", "checkbox", "file", "image"];

function slugify(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

function CustomFieldsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const blankForm = {
    label: "", field_type: "text" as Field["field_type"], required: false,
    visibility: "resident_editable" as Field["visibility"], options: "",
  };
  const [form, setForm] = useState(blankForm);

  async function load(sid: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("society_id", sid)
      .order("sort_order");
    if (error) toast.error(error.message);
    setFields(((data as any) ?? []) as Field[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!sidLoading && societyId) void load(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]);

  async function createField(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !form.label.trim()) return;
    setSaving(true);
    const opts = form.field_type === "dropdown"
      ? form.options.split("\n").map((x) => x.trim()).filter(Boolean)
      : null;
    if (form.field_type === "dropdown" && (!opts || opts.length === 0)) {
      setSaving(false);
      toast.error("Add at least one dropdown option (one per line).");
      return;
    }
    const { error } = await supabase.from("custom_fields").insert({
      society_id: societyId,
      key: slugify(form.label) || `field_${Date.now()}`,
      label: form.label.trim(),
      field_type: form.field_type,
      required: form.required,
      visibility: form.visibility,
      options: opts,
      sort_order: fields.length,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Field added");
    setForm(blankForm);
    setOpen(false);
    void load(societyId);
  }

  async function remove(id: string) {
    if (!societyId) return;
    if (!confirm("Delete this field and all resident values?")) return;
    const { error } = await supabase.from("custom_fields").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load(societyId);
  }

  async function move(id: string, dir: -1 | 1) {
    if (!societyId) return;
    const idx = fields.findIndex((f) => f.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= fields.length) return;
    const a = fields[idx], b = fields[swap];
    await supabase.from("custom_fields").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("custom_fields").update({ sort_order: a.sort_order }).eq("id", b.id);
    void load(societyId);
  }

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Custom Fields" />
        <EmptyState icon={ListChecks} title="Set up your society first" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Custom Resident Fields"
        description="Add the questions you want each resident to fill in their profile."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl"><Plus className="h-4 w-4 mr-2" /> Add Field</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl sm:max-w-md">
              <DialogHeader><DialogTitle>New field</DialogTitle></DialogHeader>
              <form onSubmit={createField} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input value={form.label} required maxLength={60}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="e.g. Vehicle registration number" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={form.field_type} onValueChange={(v) => setForm({ ...form, field_type: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Visibility</Label>
                    <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="resident_editable">Resident can edit</SelectItem>
                        <SelectItem value="admin_only">Admin only</SelectItem>
                        <SelectItem value="hidden">Hidden</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.field_type === "dropdown" && (
                  <div className="space-y-1.5">
                    <Label>Options (one per line)</Label>
                    <Textarea rows={4} value={form.options}
                      onChange={(e) => setForm({ ...form, options: e.target.value })}
                      placeholder={"Owner\nTenant\nFamily"} />
                  </div>
                )}
                <label className="flex items-center justify-between rounded-xl border border-border p-3">
                  <span className="text-sm">Required</span>
                  <Switch checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: v })} />
                </label>
                <DialogFooter>
                  <Button type="submit" disabled={saving} className="rounded-xl">
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : fields.length === 0 ? (
        <EmptyState icon={ListChecks} title="No custom fields yet"
          description="Custom fields show up on the resident profile screen." />
      ) : (
        <ul className="space-y-2">
          {fields.map((f, i) => (
            <li key={f.id}>
              <Card className="rounded-2xl">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex flex-col">
                    <button onClick={() => move(f.id, -1)} disabled={i === 0}
                      className="text-muted-foreground disabled:opacity-30 leading-none">▲</button>
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground my-0.5" />
                    <button onClick={() => move(f.id, 1)} disabled={i === fields.length - 1}
                      className="text-muted-foreground disabled:opacity-30 leading-none">▼</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{f.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {f.field_type} • {f.visibility.replace("_", " ")} {f.required && " • required"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(f.id)}
                    className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
