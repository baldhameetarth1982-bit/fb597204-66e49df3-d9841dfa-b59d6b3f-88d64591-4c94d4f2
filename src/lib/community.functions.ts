import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MarketListing = {
  id: string;
  category_id: string | null;
  kind: "offer" | "request" | "help" | "opportunity";
  title: string;
  description: string | null;
  price_inr: number | null;
  contact_method: "in_app" | "phone" | "whatsapp" | "link";
  contact_phone: string | null;
  contact_link: string | null;
  creator_type: "sociyohub" | "society" | "resident";
  /** Server-built house label for resident listings; null when the historical house is unknown. */
  house_label: string | null;
  society_name: string | null;
  is_local: boolean;
  is_mine: boolean;
  visibility: "society" | "all";
  created_at: string;
  expires_at: string | null;
  image_url: string | null;
};

const BUCKET = "community";

async function sign(paths: string[]) {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(paths, 15 * 60);
  for (const u of data ?? []) if (u.path && u.signedUrl) out.set(u.path, u.signedUrl);
  return out;
}

/** Same-society browse; contact details come back only when the owner chose to publish them (enforced in SQL). */
export const listMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ categoryId: z.string().uuid().nullable().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ items: MarketListing[] }> => {
    const sb = context.supabase as any;
    const { data: rows, error } = await sb.rpc("list_market_listings", { _category_id: data.categoryId ?? null });
    if (error) throw new Error("marketplace_unavailable");
    const list = (rows ?? []) as any[];
    const signed = await sign(list.map((r) => r.image_path).filter(Boolean));
    return { items: list.map(({ image_path, ...r }) => ({ ...r, image_url: image_path ? signed.get(image_path) ?? null : null })) };
  });

/** Owner's own listings in every state, with signed image previews. RLS limits rows to the caller. */
export const listMyListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("community_listings")
      .select("id,category_id,kind,title,description,price_inr,contact_method,contact_phone,contact_link,status,creator_type,visibility,expires_at,removed_reason,report_count,image_path,created_at,updated_at")
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("marketplace_unavailable");
    const rows = (data ?? []) as any[];
    const signed = await sign(rows.map((r) => r.image_path).filter(Boolean));
    return { items: rows.map((r) => ({ ...r, image_url: r.image_path ? signed.get(r.image_path) ?? null : null })) };
  });

function sniff(b: Uint8Array): "png" | "jpg" | "webp" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

/** Validates bytes server-side, stores in the private bucket under society/listing/, then links via the owner-checked RPC. */
export const uploadListingImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ listingId: z.string().uuid(), base64: z.string().max(2_900_000).nullable() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; message?: string }> => {
    const sb = context.supabase as any;
    const { data: row, error } = await sb
      .from("community_listings")
      .select("id,society_id,owner_id,creator_type,status,image_path")
      .eq("id", data.listingId)
      .maybeSingle();
    // market_set_image is the authority (owner / own-society admin / Super Admin); this is only an early exit.
    if (error || !row || row.status === "removed") return { ok: false, message: "You can only change photos on your own listing." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.base64 === null) {
      const r = await sb.rpc("market_set_image", { _id: row.id, _path: null });
      if (r.error) return { ok: false, message: "Could not remove the photo." };
      if (row.image_path) await supabaseAdmin.storage.from(BUCKET).remove([row.image_path]);
      return { ok: true };
    }
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 2 * 1024 * 1024) return { ok: false, message: "Photo must be 2 MB or smaller." };
    const ext = sniff(bytes);
    if (!ext) return { ok: false, message: "Only PNG, JPG or WebP photos are allowed." };
    const path = `${row.creator_type === "sociyohub" ? "platform" : row.society_id}/${row.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
      upsert: false,
    });
    if (up.error) return { ok: false, message: "Upload failed. Please try again." };
    const r = await sb.rpc("market_set_image", { _id: row.id, _path: path });
    if (r.error) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      return { ok: false, message: "Could not attach the photo." };
    }
    if (row.image_path) await supabaseAdmin.storage.from(BUCKET).remove([row.image_path]);
    return { ok: true };
  });

/** Committee moderation queue (RLS: society admins only), with signed previews. */
export const listModerationQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const [l, r] = await Promise.all([
      sb.from("community_listings").select("id,title,description,kind,status,report_count,removed_reason,image_path,created_at,expires_at").not("society_id", "is", null).order("report_count", { ascending: false }).order("created_at", { ascending: false }).limit(200),
      sb.from("community_listing_reports").select("id,listing_id,reason,status,created_at").eq("status", "open").limit(500),
    ]);
    if (l.error || r.error) throw new Error("moderation_unavailable");
    const rows = (l.data ?? []) as any[];
    const signed = await sign(rows.map((x) => x.image_path).filter(Boolean));
    return {
      listings: rows.map((x) => ({ ...x, image_url: x.image_path ? signed.get(x.image_path) ?? null : null })),
      reports: (r.data ?? []) as { id: string; listing_id: string; reason: string; status: string; created_at: string }[],
    };
  });
