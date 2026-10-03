import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sends a sponsored view/click/CTA event. The server only counts items that are
 * currently eligible for this viewer, dedupes per 30-minute window and stores
 * aggregates only — the browser never sets counters.
 */
const sent = new Set<string>();
export function recordAdEvent(adId: string, event: "view" | "click" | "cta", placement: string) {
  const k = `${adId}:${event}:${placement}`;
  if (event === "view" && sent.has(k)) return;
  sent.add(k);
  void (supabase as any).rpc("record_ad_event", { _ad_id: adId, _event: event, _placement: placement }).then(() => {}, () => {});
}

/** Records a view once at least half the element has been visible for 1 second. */
export function useAdImpression(adId: string | undefined, placement: string, enabled = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !adId || !enabled || typeof IntersectionObserver === "undefined") return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) t = setTimeout(() => { recordAdEvent(adId, "view", placement); io.disconnect(); }, 1000);
      else if (t) clearTimeout(t);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); if (t) clearTimeout(t); };
  }, [adId, placement, enabled]);
  return ref;
}
