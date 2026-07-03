import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Generate an AI-written weekly community digest summarizing top posts/comments.
 * Admin-only (we still rely on RLS for the insert).
 */
export const generateCommunityDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ societyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Admin-only: prevent any authenticated resident from triggering billable AI calls.
    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("society_id", data.societyId)
      .in("role", ["society_admin", "super_admin"])
      .maybeSingle();
    if (!roleCheck) {
      throw new Error("Forbidden: society admin only.");
    }

    // Pull the past 7 days of posts + comments
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: posts } = await supabase
      .from("posts")
      .select("id, body, created_at")
      .eq("society_id", data.societyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    // Also pull recent announcements so a quiet week still produces a digest.
    const { data: notices } = await supabase
      .from("posts")
      .select("id, body, created_at")
      .eq("society_id", data.societyId)
      .eq("kind", "announcement")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    const havePosts = (posts?.length ?? 0) > 0;
    const haveNotices = (notices?.length ?? 0) > 0;

    let corpus = "";
    if (havePosts) {
      const ids = posts!.map((p: any) => p.id);
      const { data: comments } = await supabase
        .from("post_comments")
        .select("post_id, body")
        .in("post_id", ids)
        .limit(200);

      const cmtMap = new Map<string, string[]>();
      (comments ?? []).forEach((c: any) => {
        const arr = cmtMap.get(c.post_id) ?? [];
        arr.push(c.body);
        cmtMap.set(c.post_id, arr);
      });

      corpus = posts!
        .map((p: any, i: number) => {
          const cs = (cmtMap.get(p.id) ?? []).slice(0, 5).map((c) => `  - ${c}`).join("\n");
          return `Post ${i + 1}: ${p.body}${cs ? "\nComments:\n" + cs : ""}`;
        })
        .join("\n\n");
    }
    if (haveNotices) {
      corpus += (corpus ? "\n\nRecent announcements:\n" : "Recent announcements:\n") +
        notices!.map((n: any, i: number) => `${i + 1}. ${n.body}`).join("\n");
    }

    if (!corpus.trim()) {
      // Graceful: publish a friendly placeholder digest instead of throwing.
      corpus = "The community has been quiet this week — no new discussions or announcements. Encourage residents to share updates in the feed.";
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured. Please contact support.");

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);
    let summary = "";
    try {
      const result = await generateText({
        model: gateway("google/gemini-2.5-flash"),
        system:
          "You are the SocioHub community editor. Summarize a society's weekly discussions and announcements into a friendly, neutral 4-6 sentence digest. Highlight the top themes, any decisions reached, and any questions still open. Use plain language. Never invent names or events not in the source. If the source says the community was quiet, write a warm 2-3 sentence note inviting more participation.",
        prompt: corpus.slice(0, 8000),
      });
      summary = result.text?.trim() ?? "";
    } catch (e: any) {
      throw new Error(`AI service error: ${e?.message ?? "unknown"}`);
    }
    if (!summary) throw new Error("AI returned an empty summary. Please try again.");

    // Week start = Monday of this week
    const today = new Date();
    const day = today.getDay() || 7;
    today.setDate(today.getDate() - day + 1);
    const weekStart = today.toISOString().slice(0, 10);

    const { error } = await supabase
      .from("community_digests")
      .upsert(
        { society_id: data.societyId, week_start: weekStart, summary },
        { onConflict: "society_id,week_start" },
      );
    if (error) throw new Error(error.message);

    return { ok: true, summary, weekStart };
  });
