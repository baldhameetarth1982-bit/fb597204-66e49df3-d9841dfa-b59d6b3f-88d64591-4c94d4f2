import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";

type Variant = "full" | "compact" | "mono" | "onDark";

/**
 * Official SociyoHub wordmark.
 * "Sociyo" navy, "Hub" teal. The middle "y" is the signature — two figures
 * connecting, subtly evoking community without breaking readability.
 */
export function SociyoHubLogo({
  variant = "full",
  className,
  size = 28,
  showTagline = false,
}: {
  variant?: Variant;
  className?: string;
  size?: number;
  showTagline?: boolean;
}) {
  const navy = variant === "mono" ? "currentColor" : BRAND.colors.navy;
  const teal =
    variant === "mono"
      ? "currentColor"
      : variant === "onDark"
        ? "#7FE3D4"
        : BRAND.colors.teal;
  const light = variant === "onDark" ? "#F6F8F7" : navy;

  const fontSize = size;
  const taglineSize = Math.max(10, Math.round(size * 0.32));

  return (
    <span
      className={cn("inline-flex flex-col items-start leading-none", className)}
      aria-label="SociyoHub"
      role="img"
    >
      <span
        className="font-semibold tracking-tight"
        style={{
          fontSize,
          letterSpacing: "-0.02em",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        }}
      >
        <span style={{ color: light }}>Soci</span>
        <SignatureY size={fontSize} color={teal} />
        <span style={{ color: light }}>o</span>
        <span style={{ color: teal, fontWeight: 700 }}>Hub</span>
      </span>
      {showTagline && variant !== "compact" && (
        <span
          className="mt-1 opacity-80"
          style={{ color: light, fontSize: taglineSize, letterSpacing: "0.02em" }}
        >
          {BRAND.tagline}
        </span>
      )}
    </span>
  );
}

/** The signature "y": a subtle two-figures / bridge glyph that still reads as y. */
function SignatureY({ size, color }: { size: number; color: string }) {
  const w = size * 0.62;
  const h = size * 1.05;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 20 30"
      style={{ display: "inline-block", verticalAlign: "-0.18em", margin: "0 0.01em" }}
      aria-hidden="true"
    >
      {/* left stroke of y (raised arm / person A) */}
      <path
        d="M2 4 L10 16 L10 22"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* right stroke tapering into the descender (person B + bridge) */}
      <path
        d="M18 4 L10 16 L6 28"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* small connecting dot — the "hub" between the two figures */}
      <circle cx="10" cy="16" r="1.6" fill={color} />
    </svg>
  );
}

/** Compact square app-icon concept: "S" + signature-y bridge in a rounded tile. */
export function SociyoHubMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-[22%]", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${BRAND.colors.navy}, ${BRAND.colors.teal})`,
      }}
      aria-label="SociyoHub"
      role="img"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 5 L12 14 L12 20"
          stroke="#F6F8F7"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M20 5 L12 14 L8 22"
          stroke="#F6F8F7"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="12" cy="14" r="1.8" fill="#F6F8F7" />
      </svg>
    </span>
  );
}
