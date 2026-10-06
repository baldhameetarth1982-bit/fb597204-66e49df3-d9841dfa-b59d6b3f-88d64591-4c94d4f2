import logoAsset from "@/assets/sociohub-logo-v2.png.asset.json";
import { cn } from "@/lib/utils";
import { tu } from "@/lib/i18n";

/** Official SociyoHub app icon. Use this everywhere a logo mark is needed. */
export function Logo({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src={logoAsset.url}
      alt={tu("op.sociyohub")}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("rounded-[22%] object-cover shadow-sm", className)}
    />
  );
}
