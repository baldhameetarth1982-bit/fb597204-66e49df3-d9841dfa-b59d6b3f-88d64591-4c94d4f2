import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PlanSchema = z.object({
  property_type: z.enum(["apartment", "bungalow", "mixed"]),
  blocks: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        unit_type: z.enum(["flat", "bungalow", "villa", "shop", "office"]),
        floors: z.number().int().min(0).max(80),
        units_per_floor: z.number().int().min(1).max(40),
        naming_pattern: z.enum(["A-101", "A1-101", "Plain"]).default("A-101"),
        description: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(40),
});

async function requireStructureAdmin(supabase: any, societyId: string) {
  const { data: allowed, error } = await supabase.rpc("current_user_is_society_admin_for", {
    _society_id: societyId,
  });
  if (error || !allowed) throw new Error("You don't have permission to change this society.");
}

export const planSocietyFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ text: z.string().min(3).max(800) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("society_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.society_id) throw new Error("Join a society before creating a structure plan.");
    await requireStructureAdmin(context.supabase, profile.society_id);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await Promise.all([
      checkRateLimit({
        bucket: "society_structure_ai_user",
        subject: context.userId,
        limit: 10,
        windowSec: 3600,
      }),
      checkRateLimit({
        bucket: "society_structure_ai_society",
        subject: profile.society_id,
        limit: 20,
        windowSec: 86400,
      }),
    ]);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured.");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const { trackAi } = await import("@/lib/ai-usage.server");
    const { experimental_output } = await trackAi({ feature: "structure_plan", societyId: profile.society_id }, () => generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system:
        "You convert plain-English society descriptions into structured block plans for an Indian housing community app. Output ONLY valid JSON matching the schema. Examples of input: '3 towers, 10 floors, 4 flats per floor' or '20 bungalows + 1 commercial block of 8 shops'. Use unit_type=bungalow/villa for standalone houses, flat for apartments, shop/office for commercial. Set floors=0 for bungalows. Use naming_pattern A-101 for apartments, Plain for bungalows (just numbered 1,2,3).",
      prompt: data.text,
      experimental_output: Output.object({ schema: PlanSchema }),
    }));

    return { plan: experimental_output };
  });

export const applySocietyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        societyId: z.string().uuid(),
        plan: PlanSchema,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await requireStructureAdmin(supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "society_structure_apply",
      subject: data.societyId,
      limit: 10,
      windowSec: 3600,
    });
    const unitsRequested = data.plan.blocks.reduce(
      (sum, block) => sum + Math.max(1, block.floors) * block.units_per_floor,
      0,
    );
    if (unitsRequested > 5000) throw new Error("The plan is too large to apply safely.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "apply_society_structure_plan_internal",
      {
        _actor_id: context.userId,
        _society_id: data.societyId,
        _plan: data.plan,
      },
    );
    if (error) {
      console.error("[blocks-ai] plan apply failed", error.code);
      throw new Error("The structure plan could not be applied.");
    }
    const output = z
      .object({ blocks_created: z.number(), units_created: z.number() })
      .parse(result);
    return { ok: true, blocksCreated: output.blocks_created, unitsCreated: output.units_created };
  });

export const duplicateBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        blockId: z.string().uuid(),
        newName: z.string().min(1).max(40),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: src, error: sErr } = await supabase
      .from("blocks")
      .select("id, society_id, name, description")
      .eq("id", data.blockId)
      .single();
    if (sErr || !src) throw new Error("Source block not found.");
    await requireStructureAdmin(supabase, src.society_id);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "society_structure_duplicate",
      subject: src.society_id,
      limit: 20,
      windowSec: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("duplicate_society_block_internal", {
      _actor_id: context.userId,
      _block_id: src.id,
      _new_name: data.newName,
    });
    if (error) {
      console.error("[blocks-ai] duplicate failed", error.code);
      throw new Error("The block could not be duplicated.");
    }
    const output = z
      .object({ block_id: z.string().uuid(), units_created: z.number() })
      .parse(result);
    return { ok: true, blockId: output.block_id, unitsCreated: output.units_created };
  });
