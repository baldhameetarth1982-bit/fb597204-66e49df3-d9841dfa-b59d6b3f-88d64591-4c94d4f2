import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidAadhaar, nameSimilarity } from "./aadhaar";

const Input = z.object({ storagePath: z.string().min(1).max(512) });
const OcrResult = z
  .object({
    is_aadhaar_card: z.boolean(),
    aadhaar_number: z.string().max(32).nullable(),
    name: z.string().trim().max(120).nullable(),
    dob: z.string().max(32).nullable(),
  })
  .strict();

export const verifyAadhaarPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { storagePath } = data;
    const { userId, supabase } = context;

    // Storage path must live in the user's own folder
    if (!storagePath.startsWith(`${userId}/`)) {
      return { ok: false, reason: "Invalid file path." } as const;
    }

    try {
      const { checkRateLimit } = await import("@/lib/rate-limit.server");
      await checkRateLimit({
        bucket: "aadhaar_verify_user",
        subject: userId,
        limit: 5,
        windowSec: 3600,
      });
    } catch (error) {
      const { RateLimitedError } = await import("@/lib/rate-limit.server");
      if (error instanceof RateLimitedError) {
        return { ok: false, reason: "Too many attempts. Please try again later." } as const;
      }
      console.error("[aadhaar] rate-limit check failed");
      return { ok: false, reason: "Verification is temporarily unavailable." } as const;
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, reason: "AI verification is temporarily unavailable." } as const;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Download image bytes
    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("kyc-admin")
      .download(storagePath);
    if (dlErr || !file) {
      return { ok: false, reason: "Could not read uploaded image." } as const;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/jpeg";
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mime)) {
      return { ok: false, reason: "Use a JPEG, PNG, or WebP image." } as const;
    }
    if (buf.byteLength > 8 * 1024 * 1024) {
      return { ok: false, reason: "Image too large. Use a photo under 8 MB." } as const;
    }
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    // Call Lovable AI Gateway (Gemini Vision) for OCR
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              'You read Indian Aadhaar identity cards. Reply with ONLY a single JSON object, no prose, no code fences. Schema: {"is_aadhaar_card": boolean, "aadhaar_number": string|null, "name": string|null, "dob": string|null}. aadhaar_number must be the 12 digits as printed (spaces allowed). Set is_aadhaar_card=false if the image is not an Aadhaar card.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the Aadhaar fields from this image." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiResp.status === 429)
      return { ok: false, reason: "Too many attempts. Try again in a minute." } as const;
    if (aiResp.status === 402)
      return { ok: false, reason: "Verification quota exhausted. Please try later." } as const;
    if (!aiResp.ok) return { ok: false, reason: "Verification service error. Try again." } as const;

    const payload = await aiResp.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "{}";
    const parsed = (() => {
      try {
        return OcrResult.safeParse(JSON.parse(raw));
      } catch {
        return null;
      }
    })();
    if (!parsed?.success)
      return { ok: false, reason: "Could not read the card. Try a clearer photo." } as const;

    if (!parsed.data.is_aadhaar_card) {
      return { ok: false, reason: "That doesn't look like an Aadhaar card." } as const;
    }
    const digits = (parsed.data.aadhaar_number ?? "").replace(/\D/g, "");
    if (!isValidAadhaar(digits)) {
      return {
        ok: false,
        reason: "Couldn't read a valid Aadhaar number. Retake the photo in good light.",
      } as const;
    }

    // Match name against profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const profileName = (profile?.full_name ?? "").trim();
    const cardName = (parsed.data.name ?? "").trim();
    if (profileName && cardName) {
      const sim = nameSimilarity(profileName, cardName);
      if (sim < 0.6) {
        return {
          ok: false,
          reason: `Name on card ("${cardName}") doesn't match your profile name ("${profileName}").`,
        } as const;
      }
    }

    const last4 = digits.slice(-4);
    const { error: rpcErr } = await supabase.rpc("mark_aadhaar_verified", { _last4: last4 });
    if (rpcErr) {
      console.error("[aadhaar] verification persistence failed", rpcErr.code);
      return { ok: false, reason: "Verification could not be saved. Please try again." } as const;
    }

    // Best-effort cleanup — keep only verification metadata, not the photo.
    void supabaseAdmin.storage.from("kyc-admin").remove([storagePath]);

    return { ok: true, last4 } as const;
  });
