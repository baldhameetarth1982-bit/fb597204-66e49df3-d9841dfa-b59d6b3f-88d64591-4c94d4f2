import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForMcpUser } from "../supabase";

export default defineTool({
  name: "list_my_societies",
  title: "List my societies",
  description:
    "List societies the signed-in user belongs to (as resident, admin, or via profile).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const sb = supabaseForMcpUser(ctx);
    // RLS on societies restricts to the user's accessible societies.
    const { data, error } = await sb
      .from("societies")
      .select("id, name, city, plan_id, plan_status, created_at")
      .limit(50);
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { societies: data ?? [] },
    };
  },
});
