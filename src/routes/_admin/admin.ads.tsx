import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Upload, Archive, Plus, Pencil, Store, Tags } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AdReport } from "@/components/admin/AdReport";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, normalizePhone, safeHttpsUrl, validateListing, type ListingDraft } from "@/lib/discovery";

export const Route = createFileRoute("/_admin/admin/ads")({
  head: () => ({ meta: [{ title: "Ads & Services — Super Admin" }, { name: "description", content: "Manage banners, local service listings and campaigns." }] }),
  component: AdsPage,
});

// Banners never go on notices, payments, visitor approval, SOS or complaints; no full-screen ads.
const PLACEMENTS = [
  { id: "dashboard_bottom", label: "Resident home — bottom banner" },
  { id: "feed_inline", label: "Community feed — inline" },
  { id: "services", label: "Services page" },
] as const;
const KINDS = [
  { id: "service", label: "Service listing" },
  { id: "campaign", label: "Sponsored / custom campaign" },
  { id: "banner", label: "Banner" },
] as const;
const PLANS = [{ id: "basic", label: "Starter" }, { id: "pro", label: "Growth" }, { id: "premium", label: "Pro" }];

type Ad = {
  id: string; kind: "banner" | "service" | "campaign"; title: string; description: string | null; business_name: string | null;
  category_id: string | null; phone: string | null; whatsapp: string | null; link_url: string | null; cta_label: string | null;
  sponsored: boolean; placement: string; active: boolean; sort_order: number; image_path: string | null; image_url: string | null;
  starts_at: string | null; ends_at: string | null; target_cities: string[]; target_society_ids: string[]; target_plans: string[];
  archived_at: string | null;
};
type Cat = { id: string; slug: string; label: string; icon: string; sort_order: number; active: boolean };

function friendly(err: { message?: string } | null) {
  const m = err?.message ?? "";
  if (/rate_limited/.test(m)) return "Too many changes. Wait a few minutes.";
  if (/check constraint|violates/.test(m)) return "Some details aren't allowed. Check links, phone numbers and text.";
  return "Couldn't save. Try again.";
}

function status(ad: Ad) {
  const now = Date.now();
  if (!ad.active) return "Inactive";
  if (ad.starts_at && new Date(ad.starts_at).getTime() > now) return "Scheduled";
  if (ad.ends_at && new Date(ad.ends_at).getTime() <= now) return "Expired";
  return "Live";
}

function AdsPage() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ads, setAds] = useState<Ad[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [filter, setFilter] = useState<"all" | Ad["kind"]>("all");
  const [editing, setEditing] = useState<Ad | "new" | null>(null);
  const [archiving, setArchiving] = useState<Ad | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);

  async function reload() {
    setFailed(false);
    const [a, c] = await Promise.all([
      (supabase as any).from("ads").select("*").is("archived_at", null).order("sort_order").order("created_at", { ascending: false }),
      (supabase as any).from("service_categories").select("*").order("sort_order"),
    ]);
    if (a.error || c.error) { setFailed(true); setLoading(false); return; }
    const list = (a.data ?? []) as Ad[];
    const paths = list.map((x) => x.image_path).filter(Boolean) as string[];
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data } = await supabase.storage.from("ads").createSignedUrls(paths, 3600);
      for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
    setAds(list.map((x) => ({ ...x, image_url: x.image_path ? signed.get(x.image_path) ?? null : null })));
    setCats((c.data ?? []) as Cat[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  async function toggleActive(ad: Ad, v: boolean) {
    if (v && ad.kind === "banner" && ads.filter((a) => a.active && a.kind === "banner").length >= 4) {
      return toast.error("Maximum 4 active banners. Pause another first.");
    }
    const { error } = await (supabase as any).from("ads").update({ active: v }).eq("id", ad.id);
    if (error) return toast.error(friendly(error));
    toast.success(v ? "Activated" : "Deactivated");
    void reload();
  }

  async function archive(ad: Ad) {
    const { error } = await (supabase as any).from("ads").update({ archived_at: new Date().toISOString(), active: false }).eq("id", ad.id);
    if (error) return toast.error(friendly(error));
    toast.success("Archived");
    void reload();
  }

  const shown = useMemo(() => ads.filter((a) => filter === "all" || a.kind === filter), [ads, filter]);
  const catLabel = (id: string | null) => cats.find((c) => c.id === id)?.label;

  if (loading) return <div className="p-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (failed) return <PageShell><PageHeader title="Ads & Services" /><ErrorState description="We couldn't load ads. Check your connection and try again." onRetry={() => { setLoading(true); void reload(); }} /></PageShell>;

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Ads & Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">Banners, local service listings and campaigns. Pro societies never see banners or sponsored cards; official notices stay ad-free.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setCatsOpen(true)}><Tags className="h-4 w-4 mr-2" />Categories</Button>
          <Button className="min-h-11 rounded-xl" onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-2" />New</Button>
        </div>
      </header>
      <AdReport />

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Type">
        {[{ id: "all", label: "All" }, ...KINDS].map((k) => (
          <button key={k.id} role="tab" aria-selected={filter === k.id} onClick={() => setFilter(k.id as typeof filter)}
            className={`min-h-11 shrink-0 rounded-xl border px-3 text-sm font-medium ${filter === k.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground"}`}>
            {k.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">Nothing here yet. Use "New" to add one.</div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((ad) => (
            <li key={ad.id} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 ${ad.active ? "" : "opacity-60"}`}>
              {ad.image_url ? <img src={ad.image_url} alt="" className="h-14 w-20 rounded-lg bg-muted object-cover" /> : <div className="grid h-14 w-20 place-items-center rounded-lg bg-muted text-muted-foreground"><Store className="h-5 w-5" /></div>}
              <div className="min-w-0">
                <p className="truncate font-medium">{ad.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {KINDS.find((k) => k.id === ad.kind)?.label}{catLabel(ad.category_id) ? ` · ${catLabel(ad.category_id)}` : ""} · {status(ad)}
                  {ad.target_society_ids.length ? ` · ${ad.target_society_ids.length} societ${ad.target_society_ids.length === 1 ? "y" : "ies"}` : ""}
                  {ad.target_cities.length ? ` · ${ad.target_cities.join(", ")}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Switch aria-label={`${ad.active ? "Deactivate" : "Activate"} ${ad.title}`} checked={ad.active} onCheckedChange={(v) => toggleActive(ad, v)} />
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Edit ${ad.title}`} onClick={() => setEditing(ad)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Archive ${ad.title}`} onClick={() => setArchiving(ad)}><Archive className="h-4 w-4 text-destructive" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <Editor ad={editing === "new" ? null : editing} cats={cats.filter((c) => c.active)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {catsOpen && <Categories cats={cats} onClose={() => setCatsOpen(false)} onChanged={reload} />}

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{archiving?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>It stops showing everywhere. The change is kept in the audit log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (archiving) void archive(archiving); setArchiving(null); }}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

async function looksLikeImage(file: File) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const webp = String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  return png || jpg || webp;
}

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Editor({ ad, cats, onClose, onSaved }: { ad: Ad | null; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    kind: (ad?.kind ?? "service") as Ad["kind"], title: ad?.title ?? "", description: ad?.description ?? "",
    business_name: ad?.business_name ?? "", phone: ad?.phone ?? "", whatsapp: ad?.whatsapp ?? "", link_url: ad?.link_url ?? "",
    cta_label: ad?.cta_label ?? "", category_id: ad?.category_id ?? "", placement: ad?.placement ?? "services",
    sponsored: ad?.sponsored ?? false, active: ad?.active ?? true, sort_order: String(ad?.sort_order ?? 0),
    starts_at: toLocal(ad?.starts_at ?? null), ends_at: toLocal(ad?.ends_at ?? null),
    cities: (ad?.target_cities ?? []).join(", "), societies: (ad?.target_society_ids ?? []).join(", "), plans: ad?.target_plans ?? [],
  });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    const e = validateListing(f as unknown as ListingDraft);
    const cities = f.cities.split(",").map((s) => s.trim()).filter(Boolean);
    const societies = f.societies.split(",").map((s) => s.trim()).filter(Boolean);
    if (cities.length > 20 || cities.some((c) => c.length > 60 || /[<>{}]/.test(c))) e.cities = "Up to 20 plain city names.";
    if (societies.length > 50 || societies.some((s) => !UUID.test(s))) e.societies = "Use society IDs from Super Admin → Societies, separated by commas.";
    if (f.starts_at && f.ends_at && new Date(f.ends_at) <= new Date(f.starts_at)) e.ends_at = "End must be after start.";
    if (f.kind === "banner" && !file && !ad?.image_path) e.image = "Banners need an image.";
    const order = Number(f.sort_order);
    if (!Number.isInteger(order) || order < -1000 || order > 1000) e.sort_order = "Whole number between -1000 and 1000.";
    if (file) {
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES || !(await looksLikeImage(file))) e.image = "PNG, JPG or WEBP up to 2 MB.";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    let image_path = ad?.image_path ?? null;
    if (file) {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `listings/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("ads").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setSaving(false); return toast.error("Couldn't upload the image. Try again."); }
      image_path = path;
    }
    const row = {
      kind: f.kind, title: f.title.trim(), description: f.description.trim() || null, business_name: f.business_name.trim() || null,
      phone: normalizePhone(f.phone), whatsapp: normalizePhone(f.whatsapp), link_url: safeHttpsUrl(f.link_url) ?? "",
      cta_label: f.cta_label.trim() || null, category_id: f.category_id || null,
      placement: f.kind === "banner" ? f.placement : "services", sponsored: f.kind === "banner" ? true : f.kind === "campaign" ? true : f.sponsored,
      active: f.active, sort_order: order, image_path, image_url: "",
      starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null, ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
      target_cities: cities, target_society_ids: societies, target_plans: f.plans,
    };
    const q = ad ? (supabase as any).from("ads").update(row).eq("id", ad.id) : (supabase as any).from("ads").insert(row);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(friendly(error));
    toast.success(ad ? "Saved" : "Created");
    onSaved();
  }

  const field = (k: string, label: string, el: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      {el}
      {errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{ad ? "Edit" : "New"} listing</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {field("kind", "Type", (
            <Select value={f.kind} onValueChange={(v) => set("kind", v)}>
              <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          {field("title", "Title", <Input id="title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={80} />)}
          {f.kind !== "banner" && field("description", "Short description", <Textarea id="description" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={600} rows={3} />)}
          {f.kind !== "banner" && field("business_name", "Business / organiser", <Input id="business_name" value={f.business_name} onChange={(e) => set("business_name", e.target.value)} maxLength={80} />)}
          {f.kind !== "banner" && field("category_id", "Category", (
            <Select value={f.category_id || "none"} onValueChange={(v) => set("category_id", v === "none" ? "" : v)}>
              <SelectTrigger id="category_id"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
          {f.kind === "banner" && field("placement", "Placement", (
            <Select value={f.placement} onValueChange={(v) => set("placement", v)}>
              <SelectTrigger id="placement"><SelectValue /></SelectTrigger>
              <SelectContent>{PLACEMENTS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          {f.kind !== "banner" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {field("phone", "Phone", <Input id="phone" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />)}
              {field("whatsapp", "WhatsApp", <Input id="whatsapp" inputMode="tel" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />)}
            </div>
          )}
          {field("link_url", "Website / link", <Input id="link_url" value={f.link_url} onChange={(e) => set("link_url", e.target.value)} placeholder="https://" />, "https:// links only.")}
          {f.kind !== "banner" && field("cta_label", "Button label", <Input id="cta_label" value={f.cta_label} onChange={(e) => set("cta_label", e.target.value)} maxLength={24} placeholder="Website" />)}
          {field("image", "Image", (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 hover:bg-muted/40">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="truncate text-sm">{file ? file.name : ad?.image_path ? "Replace image" : "Choose image"}</span>
              <input id="image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          ), "PNG, JPG or WEBP up to 2 MB.")}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("starts_at", "Start", <Input id="starts_at" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />)}
            {field("ends_at", "End", <Input id="ends_at" type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />)}
          </div>
          {field("cities", "Cities (optional)", <Input id="cities" value={f.cities} onChange={(e) => set("cities", e.target.value)} placeholder="Ahmedabad, Surat" />, "Empty = all cities.")}
          {field("societies", "Society IDs (optional)", <Input id="societies" value={f.societies} onChange={(e) => set("societies", e.target.value)} />, "Empty = every matching society.")}
          <div className="space-y-1.5">
            <Label>Plans (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {PLANS.map((p) => {
                const on = f.plans.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => set("plans", on ? f.plans.filter((x) => x !== p.id) : [...f.plans, p.id])}
                    className={`min-h-11 rounded-xl border px-3 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{p.label}</button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Empty = all plans. Pro never sees banners or sponsored items.</p>
          </div>
          {f.kind === "service" && (
            <div className="flex items-center justify-between gap-3"><Label htmlFor="sponsored">Mark as sponsored</Label><Switch id="sponsored" checked={f.sponsored} onCheckedChange={(v) => set("sponsored", v)} /></div>
          )}
          <div className="flex items-center justify-between gap-3"><Label htmlFor="active">Active</Label><Switch id="active" checked={f.active} onCheckedChange={(v) => set("active", v)} /></div>
          {field("sort_order", "Priority (lower shows first)", <Input id="sort_order" inputMode="numeric" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} />)}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Categories({ cats, onClose, onChanged }: { cats: Cat[]; onClose: () => void; onChanged: () => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const l = label.trim();
    const slug = l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (l.length < 2 || l.length > 40 || /[<>{}]/.test(l) || slug.length < 2) return toast.error("Use 2–40 plain characters.");
    setBusy(true);
    const { error } = await (supabase as any).from("service_categories").insert({ label: l, slug, sort_order: (cats.at(-1)?.sort_order ?? 0) + 10 });
    setBusy(false);
    if (error) return toast.error(/duplicate|unique/.test(error.message) ? "That category already exists." : friendly(error));
    setLabel(""); onChanged();
  }
  async function toggle(c: Cat, v: boolean) {
    const { error } = await (supabase as any).from("service_categories").update({ active: v, updated_at: new Date().toISOString() }).eq("id", c.id);
    if (error) return toast.error(friendly(error));
    onChanged();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Service categories</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Input aria-label="New category name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Laundry" maxLength={40} />
          <Button className="min-h-11" onClick={add} disabled={busy}>Add</Button>
        </div>
        <ul className="divide-y rounded-xl border">
          {cats.map((c) => (
            <li key={c.id} className="flex min-h-12 items-center justify-between gap-3 px-3">
              <span className={c.active ? "" : "text-muted-foreground line-through"}>{c.label}</span>
              <Switch aria-label={`${c.active ? "Hide" : "Show"} ${c.label}`} checked={c.active} onCheckedChange={(v) => toggle(c, v)} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
