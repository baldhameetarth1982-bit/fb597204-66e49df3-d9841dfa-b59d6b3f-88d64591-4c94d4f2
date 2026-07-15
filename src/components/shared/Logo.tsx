import { SociyoHubMark } from "@/components/shared/SociyoHubLogo";
import { cn } from "@/lib/utils";

/**
 * Official SociyoHub app icon — the premium branded mark (navy→teal gradient
 * tile with the signature "y" bridge glyph) used on /founders. Rendered
 * everywhere a logo mark is needed so the whole app matches that identity.
 */
export function Logo({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return <SociyoHubMark size={size} className={cn(className)} />;
}
