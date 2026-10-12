import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsConfigured, isMarketingPage, readConsent, saveConsent } from "@/lib/cookie-consent";

/** Asks once, only when optional trackers exist, only on public pages. Reject is as easy as accept. */
export function CookieBanner() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(analyticsConfigured() && isMarketingPage(path) && readConsent() === null);
  }, [path]);
  if (!open) return null;
  const choose = (v: "accepted" | "rejected") => { saveConsent(v); setOpen(false); };
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie choice"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex gap-3">
        <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <p className="text-sm leading-relaxed">
          We use essential storage to keep you signed in. With your permission we also use analytics and ad
          cookies to understand visits to our public pages. Society screens are never tracked.{" "}
          <Link to="/cookies" className="font-medium underline">Cookie policy</Link>
        </p>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => choose("rejected")}>Reject optional cookies</Button>
        <Button className="min-h-11" onClick={() => choose("accepted")}>Accept all cookies</Button>
      </div>
    </div>
  );
}
