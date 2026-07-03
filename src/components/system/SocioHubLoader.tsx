import logoAsset from "@/assets/sociohub-logo-v2.png.asset.json";

/**
 * Premium branded loading indicator. Lightweight — no heavy filters or
 * backdrop-blur. Used for route pending states and initial data hydration.
 */
export function SocioHubLoader({
  label = "Loading",
  fullscreen = false,
  size = 72,
}: {
  label?: string;
  fullscreen?: boolean;
  size?: number;
}) {
  const inner = (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <div className="relative" style={{ width: size, height: size }}>
        <img
          src={logoAsset.url}
          alt=""
          aria-hidden
          width={size}
          height={size}
          className="rounded-[28%] elevation-2 animate-[sh-pulse_1.6s_ease-in-out_infinite]"
          style={{ width: size, height: size }}
        />
      </div>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-primary animate-[sh-bar_1.4s_ease-in-out_infinite]" />
      </div>
      <span className="sr-only">{label}</span>
      <style>{`
        @keyframes sh-pulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50%     { transform: scale(0.94); opacity: 0.85; }
        }
        @keyframes sh-bar {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  );

  if (!fullscreen) return inner;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 animate-in fade-in duration-200">
      {inner}
    </div>
  );
}
