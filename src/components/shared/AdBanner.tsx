import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * 320×50 reserved AdMob banner slot.
 * Shown only when:
 *   1. the society's plan has ads_enabled = true, AND
 *   2. the resident has no active ad_free subscription.
 */
export function AdBanner() {
  const { profile, user } = useAuth();
  const [adsAllowed, setAdsAllowed] = useState(false);
  const adClient = import.meta.env.VITE_ADMOB_CLIENT_ID as string | undefined;
  const adSlot = import.meta.env.VITE_ADMOB_BANNER_SLOT as string | undefined;

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!profile?.society_id || !user) { setAdsAllowed(false); return; }
      const [{ data: soc }, { data: sub }] = await Promise.all([
        supabase.from("societies").select("plan_id, plans:plans!societies_plan_id_fkey(ads_enabled)").eq("id", profile.society_id).maybeSingle(),
        (supabase as any).from("resident_subscriptions").select("expires_at,status").eq("user_id", user.id).eq("status", "active").maybeSingle(),
      ]);
      if (cancelled) return;
      const planAds = Boolean((soc as any)?.plans?.ads_enabled);
      const hasAdFree = sub && new Date(sub.expires_at) > new Date();
      setAdsAllowed(planAds && !hasAdFree);
    }
    void check();
    return () => { cancelled = true; };
  }, [profile?.society_id, user]);

  useEffect(() => {
    if (!adsAllowed || !adClient || !adSlot) return;
    if (!document.querySelector(`script[data-sociohub-admob="${adClient}"]`)) {
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.sociohubAdmob = adClient;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adClient}`;
      document.head.appendChild(script);
    }
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch { /* ad blocker */ }
  }, [adClient, adSlot, adsAllowed]);

  if (!adsAllowed) return null;

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
          Ad space · 320×50
        </div>
      )}
    </div>
  );
}
