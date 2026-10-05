import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";
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
};

const pick = (d: any): S => ({
  ads_banner_enabled: !!d?.ads_banner_enabled,
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
        })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("ps.saved"));
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
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
