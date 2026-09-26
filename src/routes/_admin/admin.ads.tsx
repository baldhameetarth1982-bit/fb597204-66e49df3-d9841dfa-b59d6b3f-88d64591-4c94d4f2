import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Megaphone, Loader2, Upload, Trash2, ExternalLink, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/ads")({
  head: () => ({ meta: [{ title: "Ads — Super Admin" }] }),
  component: AdsPage,
});

const PLACEMENTS = [
  { id: "dashboard_bottom", label: "Resident dashboard — bottom banner" },
  { id: "feed_inline", label: "Community feed — inline" },
  { id: "notices_top", label: "Notices page — top banner" },
  { id: "bills_after", label: "Bills page — after each bill" },
  { id: "interstitial", label: "Full-screen interstitial" },
] as const;

type Ad = {
  id: string; title: string; image_url: string; link_url: string;
  placement: string; active: boolean; sort_order: number;
};

function AdsPage() {
  const [loading, setLoading] = useState(true);
  const [ads, setAds] = useState<Ad[]>([]);
  const [interstitial, setInterstitial] = useState(false);
  const [seconds, setSeconds] = useState(15);
  const [deleting, setDeleting] = useState<Ad | null>(null);

  async function reload() {
    const [{ data: adsData }, { data: settings }] = await Promise.all([
      (supabase as any).from("ads").select("*").order("created_at", { ascending: false }),
      supabase.from("platform_settings").select("ads_interstitial_enabled, ads_interstitial_seconds").eq("id", 1).maybeSingle(),
    ]);
    const list = (adsData ?? []) as (Ad & { image_path?: string | null })[];
    // Refresh signed URLs for private bucket entries
    const refreshed = await Promise.all(list.map(async (ad) => {
      if (ad.image_path) {
        const { data } = await supabase.storage.from("ads").createSignedUrl(ad.image_path, 60 * 60 * 24 * 7);
        if (data?.signedUrl) return { ...ad, image_url: data.signedUrl };
      }
      return ad;
    }));
    setAds(refreshed as Ad[]);
    if (settings) {
      setInterstitial(settings.ads_interstitial_enabled ?? false);
      setSeconds(settings.ads_interstitial_seconds ?? 15);
    }
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  async function saveInterstitial() {
    const { error } = await supabase.from("platform_settings").update({
      ads_interstitial_enabled: interstitial,
      ads_interstitial_seconds: seconds,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Interstitial settings saved");
  }

  async function toggleActive(ad: Ad, v: boolean) {
    if (v && ads.filter((a) => a.active).length >= 4) {
      toast.error("Maximum 4 active ads. Disable another first.");
      return;
    }
    const { error } = await (supabase as any).from("ads").update({ active: v }).eq("id", ad.id);
    if (error) return toast.error(error.message);
    reload();
  }

  async function remove(id: string) {
    const { error } = await (supabase as any).from("ads").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Ad deleted");
    reload();
  }

  if (loading) return <div className="p-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const activeCount = ads.filter((a) => a.active).length;

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Ads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Creatives shown to societies on plans with ads.</p>
        </div>
        <NewAdDialog disabled={activeCount >= 4} onCreated={reload} />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section aria-labelledby="ads-list" className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="ads-list" className="text-sm font-semibold">Creatives</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{activeCount} of 4 active</span>
              <div className="flex gap-0.5" aria-hidden>
                {[0, 1, 2, 3].map((i) => <span key={i} className={`h-2 w-4 rounded-full ${i < activeCount ? "bg-primary" : "bg-muted"}`} />)}
              </div>
            </div>
          </div>
          {ads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">No ads yet. Use "New ad" to add one.</div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {ads.map((ad) => (
                <li key={ad.id} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 ${ad.active ? "" : "opacity-60"}`}>
                  <img src={ad.image_url} alt={ad.title} className="h-14 w-20 rounded-lg bg-muted object-cover" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{ad.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{PLACEMENTS.find((p) => p.id === ad.placement)?.label ?? ad.placement}</p>
                    <a href={ad.link_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-primary underline-offset-2 hover:underline">
                      <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{ad.link_url}</span>
                    </a>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch aria-label={`${ad.active ? "Pause" : "Activate"} ${ad.title}`} checked={ad.active} onCheckedChange={(v) => toggleActive(ad, v)} />
                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Delete ${ad.title}`} onClick={() => setDeleting(ad)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ads-inter" className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <h2 id="ads-inter" className="text-sm font-semibold">Full-screen ads</h2>
              <p className="text-xs text-muted-foreground">Shown occasionally when opening the app; skippable after the timer.</p>
            </div>
            <Switch aria-label="Enable full-screen ads" checked={interstitial} onCheckedChange={setInterstitial} />
          </div>
          <div className={interstitial ? "" : "pointer-events-none opacity-50"}>
            <div className="mb-2 flex items-center justify-between">
              <Label>Duration</Label>
              <span className="text-sm font-semibold tabular-nums">{seconds}s</span>
            </div>
            <Slider min={10} max={30} step={1} value={[seconds]} onValueChange={(v) => setSeconds(v[0])} />
            <p className="mt-2 text-xs text-muted-foreground">10–30 seconds.</p>
          </div>
          <Button onClick={saveInterstitial} className="h-11 w-full rounded-xl">Save</Button>
        </section>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>This removes the ad everywhere. It can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleting) void remove(deleting.id); setDeleting(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewAdDialog({ onCreated, disabled }: { onCreated: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [placement, setPlacement] = useState<string>("dashboard_bottom");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim() || !link.trim() || !file) {
      toast.error("Fill all fields and choose an image");
      return;
    }
    if (!/^https?:\/\//.test(link)) { toast.error("Link must start with http:// or https://"); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) { toast.error("Image must be JPG, PNG, WEBP, or GIF"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setSaving(true);
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("ads").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setSaving(false); return toast.error(up.error.message); }
    const { data: signed, error: signErr } = await supabase.storage.from("ads").createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signErr || !signed) { setSaving(false); return toast.error(signErr?.message ?? "Could not sign URL"); }
    const { error } = await (supabase as any).from("ads").insert({
      title: title.trim(), image_url: signed.signedUrl, image_path: path, link_url: link.trim(), placement, active: true,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Ad created");
    setOpen(false); setTitle(""); setLink(""); setFile(null); setPlacement("dashboard_bottom");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl" disabled={disabled}>
          <Plus className="h-4 w-4 mr-2" /> New ad
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New ad</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali sale banner" />
          </div>
          <div className="space-y-1.5">
            <Label>Destination link</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://example.com/landing" />
          </div>
          <div className="space-y-1.5">
            <Label>Placement</Label>
            <Select value={placement} onValueChange={setPlacement}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLACEMENTS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Creative (JPG / PNG / WEBP / GIF, ≤5MB)</Label>
            <label className="flex items-center gap-3 rounded-xl border-2 border-dashed p-4 cursor-pointer hover:bg-muted/40">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm truncate">{file ? file.name : "Click to choose image"}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file && <img src={URL.createObjectURL(file)} alt="" className="mt-2 max-h-40 rounded-lg object-contain bg-muted" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create ad</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
