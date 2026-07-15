import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useState } from "react";
import { Loader2, Sparkles, Save, Building2, ArrowRight, LayoutTemplate } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_society/society/bill-studio")({
  head: () => ({ meta: [{ title: "Bill Templates — SociyoHub" }] }),
  component: () => (<FeatureGate feature="bill_templates"><BillTemplatesPage /></FeatureGate>),
});

function BillTemplatesPage() {
  const { societyId, loading: sidLoading } = useSocietyId();

  if (sidLoading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!societyId) {
    return (
      <div className="pb-24">
        <MobileHero title="Bill templates" icon={LayoutTemplate} variant="teal" />
        <div className="px-4 pt-4">
          <div className="rounded-2xl bg-card border shadow-sm mb-4"><BillingCenterTabs /></div>
          <EmptyState icon={Building2} title="No society linked" description="Set up your society first." />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Billing centre"
        title="Bill templates"
        subtitle="Design how your bills look. Changes apply to future bills only — existing bills stay as generated."
        icon={LayoutTemplate}
        variant="teal"
      />
      <div className="px-4 pt-4 space-y-4">
        <div className="rounded-2xl bg-card border shadow-sm">
          <BillingCenterTabs />
        </div>
        <BillAppearanceCard societyId={societyId} />
        <SectionCard>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Need to run a billing cycle?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use the Generate tab for a bulk run, or Settings to configure auto-billing.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link to="/society/billing/generate">Go to Generate <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/*  Bill Appearance — logo, signature image, theme color, header text.        */
/* -------------------------------------------------------------------------- */

function BillAppearanceCard({ societyId }: { societyId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [themeColor, setThemeColor] = useState<string>("#0ea5e9");
  const [headerText, setHeaderText] = useState<string>("");
  const [footerText, setFooterText] = useState<string>("");
  const [showLogo, setShowLogo] = useState(true);
  const [showSignature, setShowSignature] = useState(true);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("societies")
        .select("logo_url, signature_url, bill_theme, name")
        .eq("id", societyId)
        .maybeSingle();
      if (data) {
        const soc: any = data;
        setLogoUrl(soc.logo_url ?? null);
        setSignatureUrl(soc.signature_url ?? null);
        let theme: any = {};
        try { theme = typeof soc.bill_theme === "string" ? JSON.parse(soc.bill_theme) : (soc.bill_theme ?? {}); }
        catch { theme = {}; }
        setThemeColor(theme.color || "#0ea5e9");
        setHeaderText(theme.header_text || soc.name || "");
        setFooterText(theme.footer_text || "");
        setShowLogo(theme.show_logo !== false);
        setShowSignature(theme.show_signature !== false);
      }
      setLoading(false);
    })();
  }, [societyId]);

  async function uploadTo(kind: "logo" | "signature", file: File) {
    const setBusy = kind === "logo" ? setUploadingLogo : setUploadingSig;
    setBusy(true);
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
      toast.error(e.message ?? "Upload failed");
    }
    setBusy(false);
  }

  async function saveTheme() {
    setSaving(true);
    try {
      const bill_theme = {
        color: themeColor,
        header_text: headerText.trim() || null,
        footer_text: footerText.trim() || null,
        show_logo: showLogo,
        show_signature: showSignature,
      };
      const { error } = await (supabase as any).from("societies").update({ bill_theme }).eq("id", societyId);
      if (error) throw error;
      toast.success("Template saved. Future bills will use this design.");
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    }
    setSaving(false);
  }

  async function removeAsset(kind: "logo" | "signature") {
    const patch = kind === "logo" ? { logo_url: null } : { signature_url: null };
    const { error } = await (supabase as any).from("societies").update(patch).eq("id", societyId);
    if (error) { toast.error(error.message); return; }
    if (kind === "logo") setLogoUrl(null); else setSignatureUrl(null);
    toast.success("Removed");
  }

  if (loading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-primary" /> Bill appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live preview */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: themeColor + "44" }}>
          <div className="p-4 flex items-center gap-3" style={{ backgroundColor: themeColor + "18" }}>
            {showLogo && logoUrl ? (
              <img src={logoUrl} alt="Society logo" className="h-12 w-12 rounded-lg object-contain bg-background border" />
            ) : showLogo ? (
              <div className="h-12 w-12 rounded-lg bg-muted grid place-items-center text-muted-foreground">
                <Building2 className="h-6 w-6" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate" style={{ color: themeColor }}>{headerText || "Your Society"}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Maintenance Bill · Preview</div>
            </div>
          </div>
          <div className="p-4 flex items-end justify-between gap-3">
            <div className="text-xs text-muted-foreground min-w-0">
              {footerText || "This is how the header of every bill PDF / image will look."}
            </div>
            {showSignature && signatureUrl ? (
              <div className="text-center shrink-0">
                <img src={signatureUrl} alt="Signature" className="h-10 object-contain" />
                <div className="text-[10px] text-muted-foreground border-t pt-0.5">Authorized signatory</div>
              </div>
            ) : showSignature ? (
              <div className="text-[10px] text-muted-foreground text-center shrink-0">
                <div className="h-10 w-32 border-b border-dashed" />
                <div className="pt-0.5">Signature preview</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Society logo</Label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-14 w-14 rounded-lg object-contain border bg-background" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-muted grid place-items-center text-muted-foreground">
                  <Building2 className="h-6 w-6" />
                </div>
              )}
              <div className="flex-1 space-y-1.5 min-w-0">
                <input
                  id="logo-file" type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTo("logo", f); e.currentTarget.value = ""; }}
                />
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => document.getElementById("logo-file")?.click()} disabled={uploadingLogo}>
                    {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                    Upload
                  </Button>
                  {logoUrl && (
                    <Button variant="ghost" size="sm" className="rounded-xl text-destructive" onClick={() => removeAsset("logo")}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} />
              Show logo on bill
            </label>
          </div>

          <div className="space-y-2">
            <Label>Authorized signature (image)</Label>
            <div className="flex items-center gap-3">
              {signatureUrl ? (
                <img src={signatureUrl} alt="Signature" className="h-14 w-24 rounded-lg object-contain border bg-background" />
              ) : (
                <div className="h-14 w-24 rounded-lg bg-muted grid place-items-center text-muted-foreground text-[10px]">No image</div>
              )}
              <div className="flex-1 space-y-1.5 min-w-0">
                <input
                  id="sig-file" type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTo("signature", f); e.currentTarget.value = ""; }}
                />
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => document.getElementById("sig-file")?.click()} disabled={uploadingSig}>
                    {uploadingSig ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                    Upload
                  </Button>
                  {signatureUrl && (
                    <Button variant="ghost" size="sm" className="rounded-xl text-destructive" onClick={() => removeAsset("signature")}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showSignature} onChange={(e) => setShowSignature(e.target.checked)} />
              Show signature on bill
            </label>
          </div>

          <div className="space-y-2">
            <Label>Theme color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)}
                className="h-10 w-14 rounded-lg border cursor-pointer" aria-label="Bill theme color"
              />
              <Input value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="rounded-xl font-mono" maxLength={9} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Header text</Label>
            <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Your society name" className="rounded-xl" />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Footer text (optional)</Label>
            <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Thank you for the timely payment." className="rounded-xl" />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveTheme} disabled={saving} className="rounded-xl h-11">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
