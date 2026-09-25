import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Building2, ImageIcon, LayoutTemplate, Loader2, Palette, PenLine, Type } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { SettingsSection, SaveBar } from "@/components/settings/SettingsUI";
import { ListSkeleton, LoadError, InlineNotice } from "@/components/people/PeopleUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BillingConfigCard } from "@/components/billing/BillingConfigCard";

export const Route = createFileRoute("/_society/society/bill-studio/")({
  head: () => ({
    meta: [
      { title: "Bill Templates — SociyoHub" },
      { name: "description", content: "Choose how your society's maintenance bills look." },
      { property: "og:title", content: "Bill Templates — SociyoHub" },
      { property: "og:description", content: "Logo, signature, colour and header text for society bills." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<FeatureGate feature="bill_templates"><BillTemplatesPage /></FeatureGate>),
});

function BillTemplatesPage() {
  const { societyId, loading } = useSocietyId();
  return (
    <PageShell>
      <PageHeader
        title="Bill templates"
        description="How your bills look. Changes apply to future bills only — bills already created stay as they are."
      />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : !societyId ? (
        <InlineNotice icon={Building2} title="No society linked">Set up your society first.</InlineNotice>
      ) : (
        <div className="space-y-4">
          <BillAppearance societyId={societyId} />
          <BillingConfigCard societyId={societyId} />
          <Link
            to="/society/billing/generate"
            className="flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LayoutTemplate className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">Ready to bill?</span>
              <span className="block text-muted-foreground">Generate bills for this period using this design.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      )}
    </PageShell>
  );
}

type Theme = { color: string; header: string; footer: string; showLogo: boolean; showSignature: boolean };

function BillAppearance({ societyId }: { societyId: string }) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState<Theme | null>(null);
  const [t, setT] = useState<Theme>({ color: "#0ea5e9", header: "", footer: "", showLogo: true, showSignature: true });
  const [uploading, setUploading] = useState<"logo" | "signature" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<"logo" | "signature" | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const { data, error } = await supabase
      .from("societies")
      .select("logo_url, signature_url, bill_theme, name")
      .eq("id", societyId)
      .maybeSingle();
    if (error || !data) { setState("error"); return; }
    const soc: any = data;
    setLogoUrl(soc.logo_url ?? null);
    setSignatureUrl(soc.signature_url ?? null);
    let theme: any = {};
    try { theme = typeof soc.bill_theme === "string" ? JSON.parse(soc.bill_theme) : (soc.bill_theme ?? {}); } catch { theme = {}; }
    const next: Theme = {
      color: theme.color || "#0ea5e9",
      header: theme.header_text || soc.name || "",
      footer: theme.footer_text || "",
      showLogo: theme.show_logo !== false,
      showSignature: theme.show_signature !== false,
    };
    setT(next); setSaved(next); setState("ready");
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  const dirty = !!saved && JSON.stringify(saved) !== JSON.stringify(t);
  const set = <K extends keyof Theme>(k: K, v: Theme[K]) => setT((p) => ({ ...p, [k]: v }));

  async function uploadTo(kind: "logo" | "signature", file: File) {
    setUploading(kind);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${societyId}/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("branding").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage.from("branding").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr) throw signErr;
      const url = signed?.signedUrl ?? "";
      const patch = kind === "logo" ? { logo_url: url } : { signature_url: url };
      const { error: updErr } = await (supabase as any).from("societies").update(patch).eq("id", societyId);
      if (updErr) throw updErr;
      if (kind === "logo") setLogoUrl(url); else setSignatureUrl(url);
      toast.success(`${kind === "logo" ? "Logo" : "Signature"} uploaded`);
    } catch (e: any) {
      toast.error(toSafeFinanceMessage(e, "Upload failed. Please try again."));
    }
    setUploading(null);
  }

  async function saveTheme() {
    setSaving(true);
    try {
      const bill_theme = {
        color: t.color,
        header_text: t.header.trim() || null,
        footer_text: t.footer.trim() || null,
        show_logo: t.showLogo,
        show_signature: t.showSignature,
      };
      const { error } = await (supabase as any).from("societies").update({ bill_theme }).eq("id", societyId);
      if (error) throw error;
      setSaved(t);
      toast.success("Template saved. Future bills will use this design.");
    } catch (e: any) {
      toast.error(toSafeFinanceMessage(e, "Could not save. Please try again."));
    }
    setSaving(false);
  }

  async function removeAsset(kind: "logo" | "signature") {
    const patch = kind === "logo" ? { logo_url: null } : { signature_url: null };
    const { error } = await (supabase as any).from("societies").update(patch).eq("id", societyId);
    if (error) { toast.error(toSafeFinanceMessage(error)); return; }
    if (kind === "logo") setLogoUrl(null); else setSignatureUrl(null);
    toast.success("Removed");
  }

  if (state === "loading") return <ListSkeleton rows={3} />;
  if (state === "error") return <LoadError title="Couldn't load your bill design." onRetry={() => void load()} />;

  const assetRow = (kind: "logo" | "signature", url: string | null, show: boolean, label: string, hint: string) => (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {url ? (
          <img src={url} alt={label} className={`${kind === "logo" ? "w-12" : "w-20"} h-12 shrink-0 rounded-lg border bg-background object-contain`} />
        ) : (
          <div className={`${kind === "logo" ? "w-12" : "w-20"} grid h-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground`}>
            {kind === "logo" ? <Building2 className="h-5 w-5" aria-hidden /> : <PenLine className="h-5 w-5" aria-hidden />}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{url ? hint : "Not uploaded"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={show} onCheckedChange={(v) => set(kind === "logo" ? "showLogo" : "showSignature", v)} aria-label={`Show ${label.toLowerCase()} on bills`} />
          Show
        </label>
        <input id={`${kind}-file`} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTo(kind, f); e.currentTarget.value = ""; }} />
        <Button variant="outline" size="sm" className="h-11 rounded-xl" disabled={uploading === kind}
          onClick={() => document.getElementById(`${kind}-file`)?.click()}>
          {uploading === kind && <Loader2 className="mr-1.5 h-4 w-4 motion-safe:animate-spin" />}
          {url ? "Replace" : "Upload"}
        </Button>
        {url && (
          <Button variant="ghost" size="sm" className="h-11 rounded-xl text-destructive" onClick={() => setConfirmRemove(kind)}>Remove</Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <SettingsSection title="Preview" icon={ImageIcon} description="The header and footer of every bill PDF and image.">
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: t.color + "44" }}>
            <div className="flex items-center gap-3 p-4" style={{ backgroundColor: t.color + "18" }}>
              {t.showLogo && (logoUrl ? (
                <img src={logoUrl} alt="" className="h-12 w-12 rounded-lg border bg-background object-contain" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-lg bg-muted text-muted-foreground"><Building2 className="h-6 w-6" /></div>
              ))}
              <div className="min-w-0 flex-1">
                <div className="break-words font-semibold" style={{ color: t.color }}>{t.header || "Your society"}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Maintenance bill · Preview</div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 p-4">
              <p className="min-w-0 break-words text-xs text-muted-foreground">{t.footer || "No footer text"}</p>
              {t.showSignature && (
                <div className="shrink-0 text-center text-[10px] text-muted-foreground">
                  {signatureUrl ? <img src={signatureUrl} alt="" className="h-10 object-contain" /> : <div className="h-10 w-28 border-b border-dashed" />}
                  <div className="pt-0.5">Authorised signatory</div>
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

        <div className="space-y-4">
          <SettingsSection title="Logo & signature" icon={PenLine} description="Uploads save straight away.">
            <div className="divide-y">
              {assetRow("logo", logoUrl, t.showLogo, "Society logo", "Shown at the top of each bill")}
              {assetRow("signature", signatureUrl, t.showSignature, "Authorised signature", "Shown at the bottom of each bill")}
            </div>
          </SettingsSection>

          <SettingsSection title="Colour & text" icon={Type}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bill-color" className="flex items-center gap-1.5"><Palette className="h-4 w-4 text-muted-foreground" aria-hidden />Theme colour</Label>
                <div className="flex items-center gap-2">
                  <input id="bill-color-swatch" type="color" value={t.color} onChange={(e) => set("color", e.target.value)}
                    className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border" aria-label="Pick bill theme colour" />
                  <Input id="bill-color" value={t.color} onChange={(e) => set("color", e.target.value)} className="h-11 rounded-xl font-mono" maxLength={9} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-header">Header text</Label>
                <Input id="bill-header" value={t.header} onChange={(e) => set("header", e.target.value)} placeholder="Your society name" className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-footer">Footer text <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="bill-footer" value={t.footer} onChange={(e) => set("footer", e.target.value)} placeholder="Thank you for paying on time." className="h-11 rounded-xl" />
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={saveTheme} onDiscard={() => saved && setT(saved)} saveLabel="Save design" />

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {confirmRemove === "logo" ? "logo" : "signature"}?</AlertDialogTitle>
            <AlertDialogDescription>Future bills won't show it. Bills already created are not changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const k = confirmRemove; setConfirmRemove(null); if (k) void removeAsset(k); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
