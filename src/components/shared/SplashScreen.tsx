import { useEffect, useState } from "react";
import { SocioHubLoader } from "@/components/system/SocioHubLoader";

const SESSION_KEY = "sociohub:splashed";

/**
 * Native-app style splash: full branded screen on the first load of a
 * session. Renders nothing during SSR/first paint to avoid hydration
 * mismatch (sessionStorage is unavailable on the server).
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    setVisible(true);
    const t = setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, "1");
      setVisible(false);
    }, 1600);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-background animate-in fade-in duration-200"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-6">
        <SocioHubLoader size={112} />
        <div className="flex flex-col items-center gap-1">
          <span className="type-headline text-foreground">SocioHub</span>
          <span className="text-xs text-muted-foreground">
            Society management, simplified
          </span>
        </div>
      </div>
    </div>
  );
}
