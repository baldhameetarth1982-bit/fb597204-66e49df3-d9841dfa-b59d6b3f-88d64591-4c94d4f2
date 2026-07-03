import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Building2, ArrowLeft, Copy, CheckCircle2, Upload } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { OnboardingStepper } from "@/components/system/OnboardingStepper";
import { createSocietyFull } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/onboarding/create")({
  head: () => ({ meta: [{ title: "Create society — SocioHub" }] }),
  component: CreateSociety,
});

function CreateSociety() {
  const { isLoading, isAuthenticated, user, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    registration_number: "",
    full_address: "",
    state: "",
    city: "",
    pincode: "",
    total_units: "",
    logo_url: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string; name: string } | null>(null);

  const creatorPhone = useMemo(() => profile?.phone ?? "", [profile?.phone]);
  const creatorName = useMemo(() => profile?.full_name ?? "", [profile?.full_name]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("society_id")
      .eq("user_id", user.id)
      .eq("role", "society_admin")
      .not("society_id", "is", null)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.society_id) navigate({ to: "/onboarding/plan" });
      });
  }, [user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function handleLogo(file: File) {
    if (!user) return;
    setUploadBusy(true);
    try {
      const path = `society-logos/${user.id}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      update("logo_url", data.publicUrl);
      toast.success("Logo uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      toast.error("Please accept the Terms of Service and Privacy Policy");
      return;
    }
    if (saving) return; // double-tap guard
    setSaving(true);
    try {
      const ref = typeof window !== "undefined" ? localStorage.getItem("sociohub:ref") : null;
      const soc = await createSocietyFull({
        name: form.name.trim(),
        registration_number: form.registration_number.trim() || undefined,
        full_address: form.full_address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        logo_url: form.logo_url.trim() || undefined,
        total_units: form.total_units ? Number(form.total_units) : undefined,
        referral_code: ref || undefined,
      });
      if (ref) localStorage.removeItem("sociohub:ref");
      await refresh();
      setCreated({ id: soc.id, code: soc.invite_code as string, name: soc.name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create society");
    } finally {
      setSaving(false);
    }
  }

  function copyCode() {
    if (!created) return;
    navigator.clipboard.writeText(created.code);
    toast.success("Code copied");
  }

  if (created) {
    return (
      <div className="px-5 py-8 space-y-6 max-w-md mx-auto">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="type-title">Society created</h1>
          <p className="text-sm text-muted-foreground">
            Share this code with residents so they can join <strong>{created.name}</strong>.
          </p>
        </div>
        <Card className="rounded-3xl border-0 bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-xs uppercase tracking-wider opacity-80">Society invite code</p>
            <p className="text-4xl font-bold tracking-[0.4em] font-mono">{created.code}</p>
            <Button onClick={copyCode} variant="secondary" className="rounded-xl h-10 mt-2">
              <Copy className="h-4 w-4 mr-2" /> Copy code
            </Button>
          </CardContent>
        </Card>
        <Button onClick={() => navigate({ to: "/onboarding/plan" })} className="w-full h-12 rounded-2xl">
          Continue — choose your plan
        </Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 space-y-5 max-w-md mx-auto">
      <Link
        to="/onboarding"
        search={{} as any}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Link>

      <OnboardingStepper step={1} total={4} labels={["Society details", "Choose plan", "Payment", "Setup"]} />

      <header className="space-y-2">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <h1 className="type-title">Create your society</h1>
        <p className="text-sm text-muted-foreground">
          You'll become the Chairman with full admin rights. A unique invite code is generated automatically.
        </p>
      </header>

      <Card className="rounded-3xl">
        <CardContent className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Logo */}
            <div className="space-y-2">
              <Label>Society logo (optional)</Label>
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 rounded-2xl bg-secondary grid place-items-center overflow-hidden">
                  {form.logo_url ? (
                    <img src={form.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleLogo(e.target.files[0])}
                  />
                  <div className="rounded-2xl border border-dashed border-border p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground cursor-pointer hover:bg-secondary/40">
                    {uploadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{form.logo_url ? "Change logo" : "Upload logo"}</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Society name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                maxLength={120}
                placeholder="e.g. Sunrise Heights"
                className="h-11 rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="regn">Registration number (optional)</Label>
              <Input
                id="regn"
                value={form.registration_number}
                onChange={(e) => update("registration_number", e.target.value)}
                placeholder="e.g. MH/PN/12345/2023"
                className="h-11 rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="addr">Full address</Label>
              <Input
                id="addr"
                value={form.full_address}
                onChange={(e) => update("full_address", e.target.value)}
                placeholder="Building, street, area"
                className="h-11 rounded-2xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  maxLength={60}
                  placeholder="Maharashtra"
                  className="h-11 rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  maxLength={60}
                  placeholder="Mumbai"
                  className="h-11 rounded-2xl"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pin">PIN code</Label>
                <Input
                  id="pin"
                  inputMode="numeric"
                  value={form.pincode}
                  onChange={(e) => update("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="411001"
                  className="h-11 rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="units">Total units</Label>
                <Input
                  id="units"
                  inputMode="numeric"
                  value={form.total_units}
                  onChange={(e) => update("total_units", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="e.g. 120"
                  className="h-11 rounded-2xl"
                />
              </div>
            </div>

            <div className="rounded-2xl bg-secondary/50 p-4 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Creator (you)</p>
              <div className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium truncate">{creatorName || "—"}</span>
                </div>
                <div className="flex justify-between gap-3 mt-1">
                  <span className="text-muted-foreground">Mobile</span>
                  <span className="font-medium truncate">{creatorPhone || "verified via login"}</span>
                </div>
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span>
                I agree to the{" "}
                <Link to="/terms" target="_blank" className="text-primary underline">
                  Terms of Service &amp; Privacy Policy
                </Link>
                .
              </span>
            </label>

            <Button type="submit" disabled={saving || !agreed} className="w-full h-12 rounded-2xl">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create society
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
