import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { tu } from "@/lib/i18n";

export type AppStatus = { maintenance: boolean; message: string | null };

/** Platform maintenance flag, readable by everyone (no private data). */
export function useAppStatus() {
  return useQuery({
    queryKey: ["app-status"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<AppStatus> => {
      const { data, error } = await (supabase.rpc as any)("get_app_status");
      if (error) throw error;
      const d = (data ?? {}) as Partial<AppStatus>;
      return { maintenance: !!d.maintenance, message: d.message ?? null };
    },
  });
}

/** Full page shown on signed-in pages while the platform is under maintenance. */
export function MaintenanceScreen({ message }: { message: string | null }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-muted">
          <Wrench className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">{tu("ln.mt.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message || tu("ln.mt.body")}</p>
      </div>
    </div>
  );
}

/** Thin strip for Super Admin and staff so they remember maintenance is on. */
export function MaintenanceStrip() {
  return (
    <div role="status" className="bg-warning/15 px-4 py-1.5 text-center text-xs font-medium text-foreground">
      {tu("ln.mt.strip")}
    </div>
  );
}
