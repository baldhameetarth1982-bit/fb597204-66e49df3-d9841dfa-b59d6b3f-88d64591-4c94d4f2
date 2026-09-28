import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/context/AuthContext";
import { listDiscovery } from "@/lib/discovery.functions";
import { safeHttpsUrl } from "@/lib/discovery";

/**
 * Sponsored banner for a placement. The server decides what may be shown
 * (targeting, dates, Pro/ad-free), so this renders nothing when not allowed.
 * Never place it on payments, visitor approval, SOS, notices or complaints.
 */
export function AdBanner({ placement = "dashboard_bottom" }: { placement?: string }) {
  const { user } = useAuth();
  const fetchItems = useServerFn(listDiscovery);
  const { data } = useQuery({
    enabled: !!user,
    queryKey: ["discovery", "banner", placement, user?.id],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchItems({ data: { kind: "banner", placement } }),
  });
  const ads = (data?.items ?? []).filter((a) => a.image_url);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % ads.length), 8000);
    return () => clearInterval(t);
  }, [ads.length]);
  const ad = ads[idx % Math.max(ads.length, 1)];
  if (!ad) return null;
  const href = safeHttpsUrl(ad.link_url);
  const body = (
    <>
      <img src={ad.image_url!} alt={ad.title} loading="lazy" className="w-full h-auto object-cover aspect-[16/5]" />
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>Sponsored</span>
        <span className="truncate ml-2">{ad.title}</span>
      </div>
    </>
  );
  return (
    <div className="w-full flex justify-center py-3" aria-label="Sponsored">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer sponsored" className="block w-full max-w-md rounded-2xl overflow-hidden border bg-muted/40 hover:opacity-95 transition">{body}</a>
      ) : (
        <div className="block w-full max-w-md rounded-2xl overflow-hidden border bg-muted/40">{body}</div>
      )}
    </div>
  );
}
