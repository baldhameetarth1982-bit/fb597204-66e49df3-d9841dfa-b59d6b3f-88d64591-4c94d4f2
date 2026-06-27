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
    if (!confirm("Delete this ad?")) return;
    const { error } = await (supabase as any).from("ads").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Ad deleted");
    reload();
  }

  if (loading) return <div className="p-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const activeCount = ads.filter((a) => a.active).length;

  return (
    <div className="px-6 py-8 max-w-4xl space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Megaphone className="h-7 w-7 text-primary" /> Ads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage ad creatives shown on Basic-plan societies. Max <b>4 active ads</b> across all placements.
          </p>
        </div>
        <NewAdDialog disabled={activeCount >= 4} onCreated={reload} />
      </header>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active ads <span className="text-muted-foreground font-normal">({activeCount}/4)</span></CardTitle>
        </CardHeader>
        <CardContent>
          {ads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No ads yet. Click "New ad" to add one.</p>
          ) : (
            <div className="grid gap-3">
              {ads.map((ad) => (
                <div key={ad.id} className="flex items-center gap-4 rounded-xl border p-3">
                  <img src={ad.image_url} alt={ad.title} className="h-16 w-24 rounded-lg object-cover bg-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{ad.title}</div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      <a href={ad.link_url} target="_blank" rel="noreferrer" className="underline truncate">{ad.link_url}</a>
                    </div>
                    <div className="text-xs mt-0.5">
                      Placement: <span className="font-medium">{PLACEMENTS.find((p) => p.id === ad.placement)?.label ?? ad.placement}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={ad.active} onCheckedChange={(v) => toggleActive(ad, v)} />
                    <Button variant="ghost" size="icon" onClick={() => remove(ad.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Interstitial duration</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable full-screen ads</p>
              <p className="text-xs text-muted-foreground">Shown occasionally when opening the app. Skippable after timer.</p>
            </div>
            <Switch checked={interstitial} onCheckedChange={setInterstitial} />
          </div>
          <div className={interstitial ? "" : "opacity-50 pointer-events-none"}>
            <div className="flex items-center justify-between mb-2">
              <Label>Duration (seconds)</Label>
              <span className="font-mono text-sm">{seconds}s</span>
            </div>
            <Slider min={10} max={30} step={1} value={[seconds]} onValueChange={(v) => setSeconds(v[0])} />
            <p className="text-xs text-muted-foreground mt-2">Range: 10–30 seconds. Applies to ads with "interstitial" placement.</p>
          </div>
          <Button onClick={saveInterstitial} className="rounded-xl">Save</Button>
        </CardContent>
      </Card>
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
