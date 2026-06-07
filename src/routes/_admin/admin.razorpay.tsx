import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/razorpay")({
  head: () => ({ meta: [{ title: "Razorpay — Super Admin" }] }),
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
    if (keySecret && keySecret.length < 20) {
      toast.error("Secret looks too short");
      return;
    }
    setSaving(true);
    const payload: {
      razorpay_key_id: string;
      razorpay_configured: boolean;
      razorpay_key_secret?: string;
    } = {
      razorpay_key_id: keyId.trim(),
      razorpay_configured: true,
    };
    if (keySecret) payload.razorpay_key_secret = keySecret.trim();
    const { error } = await supabase.from("platform_settings").update(payload).eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConfigured(true);
    setKeySecret("");
    toast.success("Razorpay credentials saved. Plan checkout is now live.");
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
    toast.success("Razorpay disconnected. Checkout is paused.");
  }

  if (loading) {
    return <div className="p-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <CreditCard className="h-7 w-7 text-primary" /> Razorpay
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Razorpay to enable plan checkout and resident maintenance payments.
        </p>
      </header>

      <Card className={`rounded-2xl ${configured ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <CardContent className="p-5 flex items-center gap-3">
          <ShieldCheck className={`h-5 w-5 ${configured ? "text-emerald-500" : "text-amber-500"}`} />
          <div>
            <p className="font-medium">{configured ? "Live — checkout enabled" : "Not configured — checkout is blocked"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {configured
                ? "Users can purchase plans and pay maintenance."
                : "Until you save valid keys, the server rejects all checkout attempts. Users cannot bypass this."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Credentials</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rzp-key">Key ID</Label>
            <Input id="rzp-key" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_xxxxxxxxxxxx" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rzp-secret">Key Secret</Label>
            <Input
              id="rzp-secret"
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder={configured ? "•••••••••• (leave blank to keep current)" : "Paste your live secret"}
            />
            <p className="text-xs text-muted-foreground">Stored encrypted at rest. Never sent to the browser after save.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !keyId} className="rounded-xl">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save & enable checkout
            </Button>
            {configured && (
              <Button onClick={disconnect} variant="outline" className="rounded-xl">Disconnect</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
