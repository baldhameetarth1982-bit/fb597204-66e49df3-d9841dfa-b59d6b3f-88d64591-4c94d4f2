import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Relation = z.enum(["spouse", "child", "parent", "sibling", "helper", "other"]);

const CreateSchema = z.object({
  full_name: z.string().trim().min(1).max(80),
  relation: Relation,
  phone: z.string().trim().max(20).regex(/^[+\d\s\-()]*$/).optional().nullable(),
  age: z.number().int().min(0).max(120).optional().nullable(),
});

export const listFamily = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("family_members")
      .select("id, full_name, relation, phone, age, created_at")
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { checkRateLimit } = await import("./rate-limit.server");
    await checkRateLimit({ bucket: "family.add", subject: context.userId, limit: 20 });

    const { count } = await context.supabase
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((count ?? 0) >= 15) throw new Error("Maximum 15 family members allowed.");

    const { error } = await context.supabase.from("family_members").insert({
      user_id: context.userId,
      full_name: data.full_name,
      relation: data.relation,
      phone: data.phone ?? null,
      age: data.age ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { checkRateLimit } = await import("./rate-limit.server");
    await checkRateLimit({ bucket: "family.delete", subject: context.userId, limit: 30 });
    const { error } = await context.supabase
      .from("family_members")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
