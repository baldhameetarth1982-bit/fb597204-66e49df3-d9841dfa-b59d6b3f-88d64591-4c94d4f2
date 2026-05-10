import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Building2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Set up your society — SocioHub" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { isLoading, isAuthenticated, user, refresh } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    registration_no: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  // If user already has a society as admin, redirect away
  useEffect(() => {
    async function check() {
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("society_id")
        .eq("user_id", user.id)
        .eq("role", "society_admin")
        .not("society_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (data?.society_id) navigate({ to: "/society/dashboard" });
    }
    void check();
  }, [user, navigate]);

  if (isLoading) {
    return (
      <AuthShell>
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    // 1. Create society
    const { data: soc, error: socErr } = await supabase
      .from("societies")
      .insert({
        name: form.name.trim(),
        registration_no: form.registration_no.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
        status: "active",
      })
      .select("id")
      .single();

    if (socErr || !soc) {
      setSaving(false);
      toast.error(socErr?.message ?? "Could not create society");
      return;
    }

    // 2. Claim society_admin role for this society
    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: user.id,
      role: "society_admin",
      society_id: soc.id,
    });
    if (roleErr) {
      setSaving(false);
      toast.error(roleErr.message);
      return;
    }

    // 3. Attach society_id to profile
    await supabase.from("profiles").update({ society_id: soc.id }).eq("id", user.id);

    await refresh();
    toast.success("Society created");
    setSaving(false);
    navigate({ to: "/society/dashboard" });
  }

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <AuthShell>
      <div className="mb-6 text-center">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Set up your society</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A few details and you'll be ready to add blocks, flats and residents.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Society name</Label>
          <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} required placeholder="e.g. Sunrise Heights" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reg">Registration no. (optional)</Label>
          <Input id="reg" value={form.registration_no} onChange={(e) => update("registration_no", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Textarea id="address" value={form.address} onChange={(e) => update("address", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={form.city} onChange={(e) => update("city", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input id="state" value={form.state} onChange={(e) => update("state", e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pin">Pincode</Label>
          <Input id="pin" value={form.pincode} onChange={(e) => update("pincode", e.target.value)} />
        </div>

        <Button type="submit" disabled={saving} className="w-full rounded-xl h-11">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create society
        </Button>
      </form>
    </AuthShell>
  );
}
