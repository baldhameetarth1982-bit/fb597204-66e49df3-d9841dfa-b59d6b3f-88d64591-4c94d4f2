import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/admin/settings")({
  head: () => ({ meta: [{ title: "Platform Settings — Super Admin" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => (await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [state, setState] = useState<any>({});
  useEffect(() => { if (data) setState(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("platform_settings").update({
        ads_banner_enabled: !!state.ads_banner_enabled,
        ads_interstitial_enabled: !!state.ads_interstitial_enabled,
        ads_interstitial_seconds: Math.min(30, Math.max(10, Number(state.ads_interstitial_seconds) || 15)),
        maintenance_fee_percent: Number(state.maintenance_fee_percent) || 0,
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="px-6 py-8 space-y-6 max-w-3xl">
      <header className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Platform Settings</h1>
          <p className="text-sm text-muted-foreground">Global toggles for ads, fees and gateway defaults.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-6 space-y-5">
          <h2 className="font-semibold">Advertisements</h2>
          <div className="flex items-center justify-between">
            <div>
              <Label>Banner ads</Label>
              <p className="text-xs text-muted-foreground">Show banner ads inside resident feed / dashboards.</p>
            </div>
            <Switch checked={!!state.ads_banner_enabled} onCheckedChange={(v) => setState((s: any) => ({ ...s, ads_banner_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Interstitial ads</Label>
              <p className="text-xs text-muted-foreground">Full-screen ads on navigation (10–30s).</p>
            </div>
            <Switch checked={!!state.ads_interstitial_enabled} onCheckedChange={(v) => setState((s: any) => ({ ...s, ads_interstitial_enabled: v }))} />
          </div>
          <div>
            <Label>Interstitial duration (sec)</Label>
            <Input type="number" min={10} max={30} value={state.ads_interstitial_seconds ?? 15} onChange={(e) => setState((s: any) => ({ ...s, ads_interstitial_seconds: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-semibold">Transaction fees</h2>
          <div>
            <Label>Maintenance transaction fee (%)</Label>
            <Input type="number" step="0.01" value={state.maintenance_fee_percent ?? 1.5} onChange={(e) => setState((s: any) => ({ ...s, maintenance_fee_percent: e.target.value }))} />
            <p className="text-xs text-muted-foreground mt-1">Platform fee applied on top of every Razorpay maintenance payment.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
