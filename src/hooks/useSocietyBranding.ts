import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getBranding } from "@/lib/branding.functions";

export const brandingKey = (societyId: string | null | undefined) => ["society-branding", societyId] as const;

/** Effective saved branding for a society (empty when not Premium). Cached 5 min. */
export function useSocietyBranding(societyId: string | null | undefined) {
  const fn = useServerFn(getBranding);
  return useQuery({
    enabled: !!societyId,
    queryKey: brandingKey(societyId),
    staleTime: 5 * 60_000,
    retry: (n, e) => (e as Error)?.message !== "forbidden" && n < 1,
    queryFn: () => fn({ data: { societyId: societyId! } }),
  });
}

/** Short-lived signed URL for a private branding logo. */
export function useBrandLogoUrl(path: string | null | undefined) {
  return useQuery({
    enabled: !!path,
    queryKey: ["brand-logo-url", path],
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("branding").createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
