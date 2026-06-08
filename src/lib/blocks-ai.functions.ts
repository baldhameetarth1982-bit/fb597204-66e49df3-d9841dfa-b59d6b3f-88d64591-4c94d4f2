import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PlanSchema = z.object({
  property_type: z.enum(["apartment", "bungalow", "mixed"]),
  blocks: z.array(
    z.object({
      name: z.string().min(1).max(40),
      unit_type: z.enum(["flat", "bungalow", "villa", "shop", "office"]),
      floors: z.number().int().min(0).max(80),
      units_per_floor: z.number().int().min(1).max(40),
      naming_pattern: z.enum(["A-101", "A1-101", "Plain"]).default("A-101"),
      description: z.string().optional(),
    }),
  ),
});

export const planSocietyFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ text: z.string().min(3).max(800) }).parse(i))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured.");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const { experimental_output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system:
        "You convert plain-English society descriptions into structured block plans for an Indian housing community app. Output ONLY valid JSON matching the schema. Examples of input: '3 towers, 10 floors, 4 flats per floor' or '20 bungalows + 1 commercial block of 8 shops'. Use unit_type=bungalow/villa for standalone houses, flat for apartments, shop/office for commercial. Set floors=0 for bungalows. Use naming_pattern A-101 for apartments, Plain for bungalows (just numbered 1,2,3).",
      prompt: data.text,
      experimental_output: Output.object({ schema: PlanSchema }),
    });

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

    await supabase
      .from("societies")
      .update({ property_type: data.plan.property_type })
      .eq("id", data.societyId);

    let blocksCreated = 0;
    let unitsCreated = 0;

    for (const b of data.plan.blocks) {
      const { data: block, error: bErr } = await supabase
        .from("blocks")
        .insert({
          society_id: data.societyId,
          name: b.name,
          description: b.description ?? null,
        })
        .select("id")
        .single();
      if (bErr || !block) continue;
      blocksCreated++;

      const units: any[] = [];
      const floors = Math.max(1, b.floors);
      const isFloored = b.unit_type === "flat" || b.unit_type === "office";
      for (let f = isFloored ? 1 : 0; f <= floors; f++) {
        for (let u = 1; u <= b.units_per_floor; u++) {
          let number: string;
          if (!isFloored) number = `${b.name}-${u}`;
          else if (b.naming_pattern === "Plain") number = `${u + f * 100}`;
          else if (b.naming_pattern === "A1-101") number = `${b.name}${f}-${String(u).padStart(2, "0")}`;
          else number = `${b.name}-${f}${String(u).padStart(2, "0")}`;
          units.push({
            society_id: data.societyId,
            block_id: block.id,
            flat_number: number,
            floor: isFloored ? f : null,
            unit_type: b.unit_type,
            status: "vacant",
          });
        }
        if (!isFloored) break;
      }
      if (units.length) {
        const { error: uErr } = await supabase.from("flats").insert(units);
        if (!uErr) unitsCreated += units.length;
      }
    }

    return { ok: true, blocksCreated, unitsCreated };
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

    const { data: newBlock, error: nbErr } = await supabase
      .from("blocks")
      .insert({
        society_id: src.society_id,
        name: data.newName,
        description: src.description,
      })
      .select("id")
      .single();
    if (nbErr || !newBlock) throw new Error(nbErr?.message ?? "Could not create block.");

    const { data: flats } = await supabase
      .from("flats")
      .select("flat_number, floor, type, area_sqft, unit_type")
      .eq("block_id", src.id);

    let unitsCreated = 0;
    if (flats?.length) {
      const newFlats = flats.map((f: any) => ({
        society_id: src.society_id,
        block_id: newBlock.id,
        // Replace leading "<srcname>-" prefix with new name if present
        flat_number: f.flat_number.startsWith(`${src.name}-`)
          ? `${data.newName}-${f.flat_number.slice(src.name.length + 1)}`
          : f.flat_number,
        floor: f.floor,
        type: f.type,
        area_sqft: f.area_sqft,
        unit_type: f.unit_type ?? "flat",
        status: "vacant",
      }));
      const { error: iErr } = await supabase.from("flats").insert(newFlats);
      if (!iErr) unitsCreated = newFlats.length;
    }

    return { ok: true, blockId: newBlock.id, unitsCreated };
  });
