import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

type Ad = {
  id: string;
  title: string;
  image_url: string;
  image_path: string | null;
  link_url: string;
  placement: string;
};

/**
 * Renders active ads uploaded from Super Admin → Ads for a given placement.
 * Hidden if the resident has an active ad_free subscription.
 * Rotates every 8s when multiple ads target the same placement.
 */
export function AdBanner({ placement = "dashboard_bottom" }: { placement?: string }) {
  const { user } = useAuth();
  const [ads, setAds] = useState<Ad[]>([]);
  const [idx, setIdx] = useState(0);
  const [adFree, setAdFree] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: adsData }, { data: sub }] = await Promise.all([
        (supabase as any)
          .from("ads")
          .select("id,title,image_url,image_path,link_url,placement")
          .eq("active", true)
          .eq("placement", placement)
          .order("sort_order", { ascending: true }),
        user
          ? (supabase as any)
              .from("resident_subscriptions")
              .select("expires_at,status")
              .eq("user_id", user.id)
              .eq("status", "active")
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setAdFree(Boolean(sub && new Date(sub.expires_at) > new Date()));

      // Refresh signed URLs for private bucket entries
      const list = (adsData ?? []) as Ad[];
      const refreshed = await Promise.all(
        list.map(async (ad) => {
          if (ad.image_path) {
            const { data } = await supabase.storage
              .from("ads")
              .createSignedUrl(ad.image_path, 60 * 60 * 24 * 7);
            if (data?.signedUrl) return { ...ad, image_url: data.signedUrl };
          }
          return ad;
        }),
      );
      if (!cancelled) setAds(refreshed);
    })();
    return () => {
      cancelled = true;
    };
  }, [placement, user?.id]);

  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % ads.length), 8000);
    return () => clearInterval(t);
  }, [ads.length]);

  const ad = useMemo(() => ads[idx] ?? null, [ads, idx]);
  if (adFree || !ad) return null;

  return (
    <div className="w-full flex justify-center py-3" aria-label="Sponsored">
      <a
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="block w-full max-w-md rounded-2xl overflow-hidden border bg-muted/40 hover:opacity-95 transition"
      >
        <img
          src={ad.image_url}
          alt={ad.title}
          loading="lazy"
          className="w-full h-auto object-cover aspect-[16/5]"
        />
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Sponsored</span>
          <span className="truncate ml-2">{ad.title}</span>
        </div>
      </a>
    </div>
  );
}
