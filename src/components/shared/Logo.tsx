import logoAsset from "@/assets/sociohub-logo.jpeg.asset.json";
import { cn } from "@/lib/utils";

/** Official SocioHub app icon. Use this everywhere a logo mark is needed. */
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
      alt="SocioHub"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("rounded-[22%] object-cover shadow-sm", className)}
    />
  );
}
