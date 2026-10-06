import { Building2 } from "lucide-react";
import { HEX_RE, readableOn } from "@/lib/branding";
import { tu } from "@/lib/i18n";

/**
 * Society identity band. Only validated hex colours are ever applied (as
 * inline colour values), so branding data can't inject CSS or markup.
 * "Powered by SociyoHub" always stays visible — this is society branding,
 * not removal of the platform identity.
 */
export function SocietyBrandBanner({
  name, primary, accent, logoUrl, subtitle = "Your society",
}: {
  name: string;
  primary: string | null;
  accent: string | null;
  logoUrl: string | null;
  subtitle?: string;
}) {
  const bg = primary && HEX_RE.test(primary) ? primary : null;
  const ac = accent && HEX_RE.test(accent) ? accent : null;
  const fg = bg ? readableOn(bg) : null;
  return (
    <div
      className={bg ? "rounded-2xl p-4 flex items-center gap-3" : "rounded-2xl p-4 flex items-center gap-3 bg-muted"}
      style={bg ? { backgroundColor: bg, color: fg! } : undefined}
    >
      <div
        className="h-12 w-12 shrink-0 rounded-xl bg-background grid place-items-center overflow-hidden border-2"
        style={ac ? { borderColor: ac } : undefined}
      >
        {logoUrl ? (
          <img src={logoUrl} alt={`${name} logo`} className="h-full w-full object-contain" loading="lazy" decoding="async" width={48} height={48} />
        ) : (
          <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs opacity-80">{subtitle}</p>
        <p className="font-semibold truncate">{name}</p>
      </div>
      <span className="text-[10px] opacity-70 shrink-0">{tu("op.powered_by_sociyohub")}</span>
    </div>
  );
}
