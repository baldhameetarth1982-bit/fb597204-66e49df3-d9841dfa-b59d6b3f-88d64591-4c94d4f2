import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const KEY = ["elder-mode"];

function useElderMode() {
  return useQuery({
    queryKey: KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data, error } = await supabase.from("profiles").select("elder_mode").eq("id", u.user.id).maybeSingle();
      if (error) throw error;
      return Boolean(data?.elder_mode);
    },
  });
}

/** Applies the saved preference to the resident app only; removed on leave. */
export function ElderModeSync() {
  const { data } = useElderMode();
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("elder-mode", !!data);
    return () => el.classList.remove("elder-mode");
  }, [data]);
  return null;
}

export function ElderModeToggle() {
  const { data, isLoading } = useElderMode();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const m = useMutation({
    mutationFn: async (on: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").update({ elder_mode: on }).eq("id", u.user.id);
      if (error) throw error;
      return on;
    },
    onSuccess: (on) => { qc.setQueryData(KEY, on); toast.success(on ? t("elder.on") : t("elder.off")); },
    onError: () => toast.error(t("elder.saveFailed")),
  });
  return (
    <section aria-label={t("elder.display")} className="flex items-center justify-between gap-4 rounded-2xl border bg-card p-4">
      <div>
        <Label htmlFor="elder-mode" className="font-semibold">{t("elder.label")}</Label>
        <p className="text-sm text-muted-foreground">{t("elder.hint")}</p>
      </div>
      <Switch id="elder-mode" checked={!!data} disabled={isLoading || m.isPending} onCheckedChange={(v) => m.mutate(v)} />
    </section>
  );
}
