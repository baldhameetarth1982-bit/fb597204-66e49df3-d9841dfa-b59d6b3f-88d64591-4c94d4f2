import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { SettingsSection, SaveBar } from "@/components/settings/SettingsUI";
import { ErrorState } from "@/components/system/ErrorState";
import { MetricsSkeleton } from "@/components/shared/MetricGroup";

export const Route = createFileRoute("/_admin/admin/settings")({
  head: () => ({ meta: [{ title: "Platform Settings — Super Admin" }] }),
  component: SettingsPage,
});

type S = {
  ads_banner_enabled: boolean;
  ads_interstitial_enabled: boolean;
  ads_interstitial_seconds: number | string;
};

const pick = (d: any): S => ({
  ads_banner_enabled: !!d?.ads_banner_enabled,
  ads_interstitial_enabled: !!d?.ads_interstitial_enabled,
  ads_interstitial_seconds: d?.ads_interstitial_seconds ?? 15,
});

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const base = useMemo(() => pick(data), [data]);
  const [state, setState] = useState<S>(base);
  useEffect(() => setState(base), [base]);
  const dirty = JSON.stringify(state) !== JSON.stringify(base);
  const set = (p: Partial<S>) => setState((s) => ({ ...s, ...p }));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_settings")
        .update({
          ads_banner_enabled: state.ads_banner_enabled,
          ads_interstitial_enabled: state.ads_interstitial_enabled,
          ads_interstitial_seconds: Math.min(
            30,
            Math.max(10, Number(state.ads_interstitial_seconds) || 15),
          ),
        })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        title="Platform Settings"
        description="Global switches that affect every society on SociyoHub."
      />
      {isLoading ? (
        <MetricsSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} showSupport={false} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <SettingsSection
            title="Advertisements"
            icon={Megaphone}
            description="Shown only to societies on plans that include ads."
          >
            <div className="divide-y divide-border">
              <Row label="Banner ads" hint="Banners inside resident feed and dashboards.">
                <Switch
                  aria-label="Banner ads"
                  checked={state.ads_banner_enabled}
                  onCheckedChange={(v) => set({ ads_banner_enabled: v })}
                />
              </Row>
              <Row label="Interstitial ads" hint="Full-screen ads between screens.">
                <Switch
                  aria-label="Interstitial ads"
                  checked={state.ads_interstitial_enabled}
                  onCheckedChange={(v) => set({ ads_interstitial_enabled: v })}
                />
              </Row>
              {state.ads_interstitial_enabled && (
                <Row
                  label="Interstitial duration"
                  hint="Between 10 and 30 seconds."
                  htmlFor="ad-sec"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id="ad-sec"
                      type="number"
                      min={10}
                      max={30}
                      className="h-11 w-20 tabular-nums"
                      value={state.ads_interstitial_seconds}
                      onChange={(e) => set({ ads_interstitial_seconds: e.target.value })}
                    />
                    <span className="text-sm text-muted-foreground">sec</span>
                  </div>
                </Row>
              )}
            </div>
          </SettingsSection>

          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            onSave={() => save.mutate()}
            onDiscard={() => setState(base)}
          />
        </div>
      )}
    </PageShell>
  );
}
