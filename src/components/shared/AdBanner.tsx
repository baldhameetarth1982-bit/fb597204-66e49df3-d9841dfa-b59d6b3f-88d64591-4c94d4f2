import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * 320×50 reserved AdMob banner slot. Shown only for societies on the 'basic' plan.
 * Drop in real AdMob/AdSense markup once production keys are configured.
 */
export function AdBanner() {
  const { profile } = useAuth();
  const [plan, setPlan] = useState<string | null>(null);
  const adClient = import.meta.env.VITE_ADMOB_CLIENT_ID as string | undefined;
  const adSlot = import.meta.env.VITE_ADMOB_BANNER_SLOT as string | undefined;

  useEffect(() => {
    if (!profile?.society_id) return;
    supabase.from("societies").select("plan").eq("id", profile.society_id).maybeSingle()
      .then(({ data }) => setPlan((data?.plan as string) ?? null));
  }, [profile?.society_id]);

  useEffect(() => {
    if (plan !== "basic" || !adClient || !adSlot) return;
    if (!document.querySelector(`script[data-sociohub-admob="${adClient}"]`)) {
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.sociohubAdmob = adClient;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adClient}`;
      document.head.appendChild(script);
    }
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch { /* ad blocker */ }
  }, [adClient, adSlot, plan]);

  if (!profile?.society_id || plan !== "basic") return null;

  return (
    <div className="w-full flex justify-center py-3" aria-label="Sponsored">
      {adClient && adSlot ? (
        <ins
          className="adsbygoogle block"
          style={{ width: 320, height: 50 }}
          data-ad-client={adClient}
          data-ad-slot={adSlot}
          data-ad-format="auto"
          data-full-width-responsive="false"
        />
      ) : (
        <div
          style={{ width: 320, height: 50 }}
          className="rounded-lg border border-dashed border-border bg-muted/40 grid place-items-center text-[10px] uppercase tracking-wider text-muted-foreground"
          data-ad-slot="dashboard-bottom-320x50"
        >
          Ad space · 320×50 · Basic plan
        </div>
      )}
    </div>
  );
}
