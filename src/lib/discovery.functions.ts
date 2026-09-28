import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DiscoveryItem = {
  id: string;
  kind: "banner" | "service" | "campaign";
  title: string;
  description: string | null;
  business_name: string | null;
  category_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  link_url: string | null;
  cta_label: string | null;
  sponsored: boolean;
  placement: string;
  image_url: string | null;
};

export type DiscoveryCategory = { id: string; slug: string; label: string; icon: string };

const Input = z.object({
  kind: z.enum(["banner", "service", "campaign"]).optional(),
  placement: z.string().regex(/^[a-z_]{2,40}$/).optional(),
});

/**
 * Resident read path for banners, service listings and campaigns.
 * Targeting (society, city, plan, dates, Pro ad-free) is enforced by the
 * list_discovery_items RPC from the caller's own profile — never from input.
 * Images live in a private bucket; we return short-lived signed URLs only.
 */
export const listDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ items: DiscoveryItem[]; categories: DiscoveryCategory[] }> => {
    const supabase = context.supabase as any;
    const [items, cats] = await Promise.all([
      supabase.rpc("list_discovery_items", { _kind: data.kind ?? null, _placement: data.placement ?? null }),
      data.kind === "banner"
        ? Promise.resolve({ data: [], error: null })
        : supabase.from("service_categories").select("id,slug,label,icon").eq("active", true).order("sort_order"),
    ]);
    if (items.error || cats.error) throw new Error("discovery_unavailable");
    const rows = (items.data ?? []) as any[];
    const paths = rows.map((r) => r.image_path).filter(Boolean) as string[];
    const signed = new Map<string, string>();
    if (paths.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: urls } = await supabaseAdmin.storage.from("ads").createSignedUrls(paths, 15 * 60);
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
    return {
      items: rows.map(({ image_path, sort_order, ...r }) => ({ ...r, image_url: image_path ? signed.get(image_path) ?? null : null })),
      categories: (cats.data ?? []) as DiscoveryCategory[],
    };
  });
