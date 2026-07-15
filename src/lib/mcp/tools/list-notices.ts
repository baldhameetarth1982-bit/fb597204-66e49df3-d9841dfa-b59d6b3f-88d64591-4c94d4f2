import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForMcpUser } from "../supabase";
import { logMcpToolError, mcpErrorContent } from "../errors";

const MAX_LIMIT = 20;
const MAX_BODY_CHARS = 500;

/** Strip HTML tags and script/style contents, collapse whitespace, cap length. */
function sanitizeNoticeBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Remove entire <script>…</script> and <style>…</style> blocks including their
  // text contents (an earlier version left `alert(1)` in the output).
  const withoutScripts = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    // Drop any lone/unclosed script or style opener too.
    .replace(/<\/?(?:script|style)\b[^>]*>/gi, " ");
  const noTags = withoutScripts.replace(/<[^>]*>/g, " ");
  const collapsed = noTags.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_BODY_CHARS
    ? `${collapsed.slice(0, MAX_BODY_CHARS)}…`
    : collapsed;
}

export default defineTool({
  name: "list_notices",
  title: "List society notices",
  description: "List recent society notices/announcements visible to the signed-in user.",
  inputSchema: {
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe("Max rows to return (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return mcpErrorContent("Not authenticated.");
    }
    const sb = supabaseForMcpUser(ctx);
    const { data, error } = await sb
      .from("notices")
      .select("id, society_id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 10, MAX_LIMIT));
    if (error) {
      logMcpToolError("list_notices", error);
      return mcpErrorContent("Unable to load notices.");
    }
    // Sanitize: strip HTML, cap body length. No internal targeting metadata.
    const notices = (data ?? []).map((n) => ({
      id: n.id,
      society_id: n.society_id,
      title: typeof n.title === "string" ? n.title.slice(0, 200) : "",
      body: sanitizeNoticeBody(n.body),
      created_at: n.created_at,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(notices, null, 2) }],
      structuredContent: { notices },
    };
  },
});

// Exported for unit testing only.
export const __test__ = { sanitizeNoticeBody };
