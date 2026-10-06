import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RotateCcw, ShieldAlert, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { brandingKey, useBrandLogoUrl, useSocietyBranding } from "@/hooks/useSocietyBranding";
import { resetBranding, setBranding } from "@/lib/branding.functions";
import { contrast, isSafeName, normalizeHex, prepareLogo } from "@/lib/branding";
import { SocietyBrandBanner } from "./SocietyBrandBanner";
import { tu } from "@/lib/i18n";

type Draft = { name: string; primary: string; accent: string; logoPath: string | null };

const MESSAGES: Record<string, string> = {
  forbidden: "Only Society Admins of this society can change branding.",
  plan_required: "Custom Branding needs the Premium plan. Nothing was changed.",
  invalid_color: "One of the colours isn't a valid colour code.",
  invalid_name: "The display name must be 2–60 characters without < > { }.",
  invalid_logo: "The logo couldn't be verified. Please upload it again.",
  invalid_type: "Use a PNG, JPG or WebP image. SVG and other files aren't allowed.",
  too_large: "The logo must be 2 MB or smaller.",
  too_small: "The logo must be at least 32×32 pixels.",
  not_image: "That file isn't a readable image.",
};

function msgFor(e: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You seem to be offline. Nothing was saved.";
  const m = (e as Error | undefined)?.message ?? "";
  return MESSAGES[m] ?? "Something went wrong. Nothing was changed — please try again.";
}

function ColorField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const valid = value === "" || !!normalizeHex(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color" aria-label={`${label} picker`}
          value={normalizeHex(value) ?? "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border bg-background p-1"
        />
        <Input
          id={id} value={value} placeholder={tu("vch.cats.default")} maxLength={7} inputMode="text" autoComplete="off"
          aria-invalid={!valid} aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 font-mono"
        />
        {value && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => onChange("")} aria-label={`Use default ${label.toLowerCase()}`}>
            {tu("vch.cats.default")}
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className={valid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
        {valid ? hint : tu("op.enter_a_colour_like_1f6feb")}
      </p>
    </div>
  );
}

export function BrandingSettingsPanel() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const qc = useQueryClient();
  const q = useSocietyBranding(societyId);
  const soc = useQuery({
    enabled: !!societyId,
    queryKey: ["society-name", societyId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("societies").select("name").eq("id", societyId!).maybeSingle();
      if (error) throw error;
      return (data?.name as string) ?? "Your society";
    },
  });
  const fnSet = useServerFn(setBranding);
  const fnReset = useServerFn(resetBranding);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [localLogo, setLocalLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedLogo = useBrandLogoUrl(q.data?.logo_path);

  const saved: Draft | null = useMemo(() => q.data ? {
    name: q.data.display_name ?? "", primary: q.data.primary_color ?? "", accent: q.data.accent_color ?? "", logoPath: q.data.logo_path,
  } : null, [q.data]);

  useEffect(() => { if (saved) setDraft(saved); }, [saved]);
  useEffect(() => () => { if (localLogo) URL.revokeObjectURL(localLogo.url); }, [localLogo]);

  if (sidLoading || (!!societyId && q.isLoading)) {
    return <div className="flex justify-center py-10" role="status" aria-label={tu("op.loading_branding")}><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!societyId) return <p className="text-sm text-muted-foreground">{tu("op.no_society_is_selected")}</p>;
  if (q.isError || !saved || !draft) {
    const forbidden = (q.error as Error | undefined)?.message === "forbidden";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <div className="rounded-xl border border-dashed p-4 space-y-3 text-center" role="alert">
        <div className="mx-auto h-10 w-10 rounded-full bg-muted grid place-items-center">{offline ? <WifiOff className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}</div>
        <p className="text-sm">{forbidden ? tu("op.you_don_t_have_access") : offline ? tu("op.you_seem_to_be_offline_2") : tu("op.branding_couldn_t_be_loaded")}</p>
        {!forbidden && <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => q.refetch()} disabled={q.isFetching}><RotateCcw className="h-4 w-4" /> {tu("common.tryAgain")}</Button>}
      </div>
    );
  }

  const d = draft;
  const primaryHex = d.primary ? normalizeHex(d.primary) : null;
  const accentHex = d.accent ? normalizeHex(d.accent) : null;
  const nameOk = d.name.trim() === "" || isSafeName(d.name);
  const colorsOk = (d.primary === "" || !!primaryHex) && (d.accent === "" || !!accentHex);
  const dirty = !!localLogo || d.name.trim() !== saved.name || (primaryHex ?? "") !== saved.primary || (accentHex ?? "") !== saved.accent || d.logoPath !== saved.logoPath;
  const lowContrast = primaryHex && contrast(primaryHex, "#FFFFFF") < 3 && contrast(primaryHex, "#111111") < 3;
  const previewName = d.name.trim() || soc.data || "Your society";
  const previewLogo = localLogo?.url ?? (d.logoPath ? savedLogo.data ?? null : null);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const blob = await prepareLogo(file);
      if (localLogo) URL.revokeObjectURL(localLogo.url);
      setLocalLogo({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setErr(msgFor(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (!dirty || !nameOk || !colorsOk || saving) return;
    setSaving(true); setErr(null);
    let uploaded: string | null = null;
    try {
      let logoPath = d.logoPath;
      if (localLogo) {
        uploaded = `${societyId}/brand-logo-${Date.now()}.png`;
        const { error } = await supabase.storage.from("branding").upload(uploaded, localLogo.blob, { contentType: "image/png", upsert: false });
        if (error) { uploaded = null; throw new Error("invalid_logo"); }
        logoPath = uploaded;
      }
      const res = await fnSet({ data: { societyId: societyId!, displayName: d.name.trim() || null, primaryColor: primaryHex, accentColor: accentHex, logoPath } });
      uploaded = null;
      if (res.previousLogoPath && res.previousLogoPath !== logoPath) {
        void supabase.storage.from("branding").remove([res.previousLogoPath]);
      }
      setLocalLogo(null);
      await qc.invalidateQueries({ queryKey: brandingKey(societyId) });
      setSavedAt(Date.now());
      toast.success(tu("op.branding_saved"));
    } catch (e) {
      if (uploaded) void supabase.storage.from("branding").remove([uploaded]);
      setErr(msgFor(e));
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true); setErr(null);
    try {
      const res = await fnReset({ data: { societyId: societyId! } });
      if (res.previousLogoPath) void supabase.storage.from("branding").remove([res.previousLogoPath]);
      setLocalLogo(null);
      await qc.invalidateQueries({ queryKey: brandingKey(societyId) });
      setSavedAt(Date.now());
      toast.success(tu("op.sociyohub_default_branding_restored"));
    } catch (e) {
      setErr(msgFor(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm" data-testid="branding-context" aria-live="polite">
        {tu("op.branding")} <span className="font-semibold">{soc.data ?? tu("op.loading_society")}</span>
      </p>
      <div className="space-y-2">
        <p className="text-sm font-medium">{tu("op.preview_resident_home_screen")}</p>
        <SocietyBrandBanner name={previewName} primary={primaryHex} accent={accentHex} logoUrl={previewLogo} />
        <p className="text-xs text-muted-foreground">
          {tu("op.this_band_appears_at_the")}
          {dirty && tu("op.you_re_previewing_unsaved_changes")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brand-name">{tu("op.display_name")}</Label>
        <Input id="brand-name" value={d.name} maxLength={60} placeholder={soc.data ?? tu("op.society_name")} aria-invalid={!nameOk}
          onChange={(e) => setDraft({ ...d, name: e.target.value })} className="h-11" />
        <p className={nameOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {nameOk ? tu("op.shown_to_residents_instead_of") : "Use 2–60 characters without < > { }."}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{tu("op.logo_2")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="brand-logo" aria-label={tu("op.upload_society_logo")} onChange={(e) => pickLogo(e.target.files?.[0])} />
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => fileRef.current?.click()} disabled={saving}>
            <ImagePlus className="h-4 w-4" /> {previewLogo ? tu("op.replace_logo") : tu("op.upload_logo")}
          </Button>
          {previewLogo && (
            <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => { setLocalLogo(null); setDraft({ ...d, logoPath: null }); }}>
              <Trash2 className="h-4 w-4" /> {tu("fd.remove")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{tu("op.png_jpg_or_webp_up")}</p>
      </div>

      <ColorField id="brand-primary" label={tu("op.primary_colour")} hint={tu("op.background_of_the_society_band")} value={d.primary} onChange={(v) => setDraft({ ...d, primary: v })} />
      <ColorField id="brand-accent" label={tu("op.accent_colour")} hint={tu("op.frame_around_your_logo")} value={d.accent} onChange={(v) => setDraft({ ...d, accent: v })} />
      {lowContrast && (
        <p className="flex items-start gap-2 text-xs text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" /> {tu("op.this_primary_colour_is_hard")}</p>
      )}

      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {savedAt && !dirty && !err && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> {tu("op.saved")}</p>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button className="min-h-11 rounded-xl" onClick={save} disabled={!dirty || !nameOk || !colorsOk || saving}>
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> {tu("cm.saving")}</> : tu("op.save_branding")}
        </Button>
        <Button variant="outline" className="min-h-11 rounded-xl" disabled={!dirty || saving} onClick={() => { setDraft(saved); setLocalLogo(null); setErr(null); }}>
          {tu("common.discard")}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="min-h-11 rounded-xl" disabled={saving || !q.data?.custom}>
              <RotateCcw className="h-4 w-4" /> {tu("op.restore_defaults")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tu("op.restore_sociyohub_default_branding")}</AlertDialogTitle>
              <AlertDialogDescription>{tu("op.your_display_name_colours_and")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tu("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={restore}>{tu("op.restore_defaults")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
