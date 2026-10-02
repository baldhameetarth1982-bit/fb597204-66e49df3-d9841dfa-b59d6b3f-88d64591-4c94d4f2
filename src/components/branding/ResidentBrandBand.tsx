import { useBrandLogoUrl, useSocietyBranding } from "@/hooks/useSocietyBranding";
import { SocietyBrandBanner } from "./SocietyBrandBanner";

/** Renders the society's saved branding; nothing when unset, not Premium, or on error. */
export function ResidentBrandBand({ societyId }: { societyId: string | null | undefined }) {
  const q = useSocietyBranding(societyId);
  const b = q.data;
  const logo = useBrandLogoUrl(b?.entitled ? b.logo_path : null);
  if (!b || !b.entitled || !b.custom) return null;
  if (!b.display_name && !b.primary_color && !b.accent_color && !b.logo_path) return null;
  return (
    <SocietyBrandBanner
      name={b.display_name ?? "Your society"}
      primary={b.primary_color}
      accent={b.accent_color}
      logoUrl={logo.data ?? null}
    />
  );
}
