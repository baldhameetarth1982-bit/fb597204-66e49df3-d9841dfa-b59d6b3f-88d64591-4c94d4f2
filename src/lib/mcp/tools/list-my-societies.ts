import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForMcpUser } from "../supabase";
import { logMcpToolError, mcpErrorContent } from "../errors";

export default defineTool({
  name: "list_my_societies",
  title: "List my societies",
  description:
    "List societies the signed-in user belongs to. Returns minimal identifying fields only.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return mcpErrorContent("Not authenticated.");
    }
    const sb = supabaseForMcpUser(ctx);
    // Minimize: id, name, city. No plan_id, no plan_status, no billing internals.
    const { data, error } = await sb
      .from("societies")
      .select("id, name, city")
      .limit(50);
    if (error) {
      logMcpToolError("list_my_societies", error);
      return mcpErrorContent("Unable to load societies.");
    }
    const societies = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(societies, null, 2) }],
      structuredContent: { societies },
    };
  },
});
