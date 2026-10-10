import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Megaphone, Store, Wrench } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { tu } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
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
  market_society_global_enabled: boolean;
  maintenance_mode: boolean;
  maintenance_message: string;
};

const pick = (d: any): S => ({
  ads_banner_enabled: !!d?.ads_banner_enabled,
  market_society_global_enabled: !!d?.market_society_global_enabled,
  maintenance_mode: !!d?.maintenance_mode,
  maintenance_message: d?.maintenance_message ?? "",
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
  const { t } = useTranslation();
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
          market_society_global_enabled: state.market_society_global_enabled,
        })
        .eq("id", 1);
      if (error) throw error;
      if (state.maintenance_mode !== base.maintenance_mode || state.maintenance_message !== base.maintenance_message) {
        const { error: mErr } = await (supabase.rpc as any)("admin_set_maintenance_mode", {
          _on: state.maintenance_mode,
          _message: state.maintenance_message,
        });
        if (mErr) throw mErr;
      }
    },
    onSuccess: () => {
      toast.success(t("ps.saved"));
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      qc.invalidateQueries({ queryKey: ["app-status"] });
    },
    onError: (e: Error) => toast.error(userMessage(e)),
  });

  return (
    <PageShell>
      <PageHeader
        title={t("ps.title")}
        description={t("ps.subtitle")}
      />
      {isLoading ? (
        <MetricsSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} showSupport={false} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <SettingsSection
            title={t("ps.ads")}
            icon={Megaphone}
            description={t("ps.adsDesc")}
          >
            <div className="divide-y divide-border">
              <Row label={t("ps.banner")} hint={t("ps.bannerHint")}>
                <Switch
                  aria-label={t("ps.banner")}
                  checked={state.ads_banner_enabled}
                  onCheckedChange={(v) => set({ ads_banner_enabled: v })}
                />
              </Row>
            </div>
          </SettingsSection>

          <SettingsSection title={t("ps.market")} icon={Store} description={t("ps.marketDesc")}>
            <Row label={t("ps.marketGlobal")} hint={t("ps.marketGlobalHint")}>
              <Switch
                aria-label={t("ps.marketGlobal")}
                checked={state.market_society_global_enabled}
                onCheckedChange={(v) => set({ market_society_global_enabled: v })}
              />
            </Row>
          </SettingsSection>

          <SettingsSection title={tu("ln.mt.section")} icon={Wrench} description={tu("ln.mt.sectionDesc")}>
            <div className="space-y-3">
              <Row label={tu("ln.mt.toggle")} hint={tu("ln.mt.toggleHint")}>
                <Switch
                  aria-label={tu("ln.mt.toggle")}
                  checked={state.maintenance_mode}
                  onCheckedChange={(v) => set({ maintenance_mode: v })}
                />
              </Row>
              <div>
                <Label htmlFor="mt-msg" className="text-sm font-medium">{tu("ln.mt.message")}</Label>
                <Textarea
                  id="mt-msg"
                  className="mt-1"
                  maxLength={300}
                  value={state.maintenance_message}
                  placeholder={tu("ln.mt.body")}
                  onChange={(e) => set({ maintenance_message: e.target.value })}
                />
              </div>
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
