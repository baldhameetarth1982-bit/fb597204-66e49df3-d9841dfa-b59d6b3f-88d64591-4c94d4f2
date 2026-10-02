import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { StatusChip } from "@/components/system/StatusChip";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_admin/admin/razorpay")({
  head: () => ({ meta: [{ title: "Payment gateway — SociyoHub Super Admin" }] }),
  component: RazorpayPage,
});

function RazorpayPage() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [savedKeyId, setSavedKeyId] = useState("");
  const [configured, setConfigured] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    const { data, error } = await supabase
      .from("platform_settings")
      .select("razorpay_key_id, razorpay_configured")
      .eq("id", 1)
      .maybeSingle();
    if (error) setFailed(true);
    else {
      setKeyId(data?.razorpay_key_id ?? "");
      setSavedKeyId(data?.razorpay_key_id ?? "");
      setConfigured(data?.razorpay_configured ?? false);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const trimmed = keyId.trim();
  const valid = /^rzp_(live|test)_[A-Za-z0-9]+$/.test(trimmed);
  const dirty = trimmed !== savedKeyId;
  const mode = savedKeyId.startsWith("rzp_test_") ? "Test mode" : savedKeyId.startsWith("rzp_live_") ? "Live mode" : null;

  async function save() {
    if (!valid) { toast.error("Key ID must start with rzp_live_ or rzp_test_."); return; }
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({ razorpay_key_id: trimmed, razorpay_configured: true })
      .eq("id", 1);
    setSaving(false);
    if (error) return toast.error("Couldn't save the gateway. Try again.");
    setSavedKeyId(trimmed);
    setConfigured(true);
    toast.success("Gateway saved and enabled.");
  }

  async function disconnect() {
    setSaving(true);
    const { error } = await supabase.from("platform_settings").update({ razorpay_configured: false }).eq("id", 1);
    setSaving(false);
    setConfirmOff(false);
    if (error) return toast.error("Couldn't turn off the gateway. Try again.");
    setConfigured(false);
    toast.success("Plan checkout turned off.");
  }

  return (
    <PageShell>
      <PageHeader
        title="Payment gateway"
        description="Razorpay collects SociyoHub plan payments only. Society maintenance stays Cash and Bank Transfer, with no platform fee."
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-48 rounded-xl" /></div>
      ) : failed ? (
        <ErrorState description="We couldn't load gateway settings. Check your connection and try again." onRetry={load} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <section aria-labelledby="rzp-cred" className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
            <div>
              <h2 id="rzp-cred" className="text-sm font-semibold">Public key</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Shown to the checkout window. Safe to store here.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rzp-key">Key ID</Label>
              <Input id="rzp-key" className="h-11 rounded-lg" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_xxxxxxxxxxxx" autoComplete="off" />
              {trimmed && !valid && <p className="text-xs text-destructive">Must start with rzp_live_ or rzp_test_.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving || !valid || (!dirty && configured)} className="min-h-11 rounded-lg">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {configured ? "Save key" : "Save and enable"}
              </Button>
              {dirty && savedKeyId && (
                <Button variant="ghost" className="min-h-11" onClick={() => setKeyId(savedKeyId)}>Discard</Button>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Plan checkout</h2>
                  <p className="text-xs text-muted-foreground">{configured ? "Societies can buy plans" : "Checkout is turned off"}</p>
                </div>
                <StatusChip tone={configured ? "success" : "warning"}>{configured ? "On" : "Off"}</StatusChip>
              </div>
              {mode && <p className="mt-3 text-xs text-muted-foreground">Key type: <span className="font-medium text-foreground">{mode}</span></p>}
              {configured && (
                <Button variant="outline" className="mt-4 min-h-11 w-full rounded-lg" onClick={() => setConfirmOff(true)} disabled={saving}>
                  Turn off checkout
                </Button>
              )}
            </section>
            <section className="space-y-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />The secret key is kept only on the server and is never entered here.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />A plan turns on only after the server confirms the payment with Razorpay.</p>
            </section>
          </aside>
        </div>
      )}

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off plan checkout?</AlertDialogTitle>
            <AlertDialogDescription>Societies won't be able to buy or renew plans until you turn it back on. Existing plans are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
