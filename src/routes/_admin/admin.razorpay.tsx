import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, ShieldCheck, Loader2, KeyRound, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";

export const Route = createFileRoute("/_admin/admin/razorpay")({
  head: () => ({ meta: [{ title: "Payment gateway — Super Admin" }] }),
  component: RazorpayPage,
});

function RazorpayPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("razorpay_key_id, razorpay_configured")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setKeyId(data.razorpay_key_id ?? "");
        setConfigured(data.razorpay_configured ?? false);
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    if (!keyId.startsWith("rzp_")) {
      toast.error("Key ID must start with rzp_live_ or rzp_test_");
      return;
    }
    if (keySecret) {
      toast.error(
        "Paste the secret in Project Settings → Secrets as RAZORPAY_KEY_SECRET, not here.",
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({ razorpay_key_id: keyId.trim(), razorpay_configured: true })
      .eq("id", 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    setConfigured(true);
    setKeySecret("");
    toast.success("Gateway saved. Ensure the server secret is also set.");
  }

  async function disconnect() {
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({ razorpay_configured: false })
      .eq("id", 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    setConfigured(false);
    toast.success("Gateway disconnected.");
  }

  return (
    <div className="min-h-dvh bg-muted/30 pb-24">
      <MobileHero
        eyebrow="Super Admin"
        title="Payment gateway"
        subtitle="Razorpay handles SocioHub plan payments. No platform fee is charged on maintenance."
        icon={CreditCard}
        variant="navy"
      />

      {loading ? (
        <div className="p-12 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">
          <SectionCard
            icon={ShieldCheck}
            title="Gateway status"
            description={configured ? "Checkout enabled" : "Not configured"}
            tone={configured ? "primary" : "default"}
            action={
              <StatusChip tone={configured ? "success" : "warning"}>
                {configured ? "Live" : "Off"}
              </StatusChip>
            }
          >
            <p className="text-sm text-muted-foreground">
              {configured
                ? "Users can purchase SocioHub plans. Society maintenance payments remain Cash + Bank Transfer by default; online maintenance gateway is enabled per-society by support."
                : "Until valid credentials are saved, the server rejects checkout attempts. Users cannot bypass this."}
            </p>
          </SectionCard>

          <SectionCard icon={KeyRound} title="Credentials">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rzp-key">Key ID</Label>
                <Input
                  id="rzp-key" className="rounded-xl"
                  value={keyId} onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_live_xxxxxxxxxxxx"
                />
              </div>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Key secret is never stored in the database</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Add it as a server secret <code className="px-1 rounded bg-muted">RAZORPAY_KEY_SECRET</code>{" "}
                    in Project Settings → Secrets. Server-side payment code reads it from there.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={save} disabled={saving || !keyId} className="rounded-xl">
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save & enable
                </Button>
                {configured && (
                  <Button onClick={disconnect} variant="outline" className="rounded-xl">
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
