import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw, WifiOff } from "lucide-react";

/**
 * App-wide connectivity notice. Reads keep showing already-loaded data;
 * when the connection returns, only failed queries are refetched.
 * Writes are never queued (see router mutation defaults).
 */
export function OfflineBanner() {
  const qc = useQueryClient();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    const back = () => { sync(); void qc.refetchQueries({ predicate: (q) => q.state.status === "error" }); };
    sync();
    window.addEventListener("offline", sync);
    window.addEventListener("online", back);
    return () => { window.removeEventListener("offline", sync); window.removeEventListener("online", back); };
  }, [qc]);

  if (!offline) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-foreground px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-sm text-background shadow-md motion-safe:animate-in motion-safe:slide-in-from-top">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>You're offline. Showing saved data — changes can't be sent until you reconnect.</span>
      <button type="button" onClick={() => window.location.reload()}
        className="ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-2 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2">
        <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
      </button>
    </div>
  );
}
