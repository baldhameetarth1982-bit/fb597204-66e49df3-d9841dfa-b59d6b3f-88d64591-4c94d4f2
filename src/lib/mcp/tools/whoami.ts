import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForMcpUser } from "../supabase";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the SociyoHub profile of the currently signed-in user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const sb = supabaseForMcpUser(ctx);
    const { data, error } = await sb
      .from("profiles")
      .select("id, full_name, phone, email, society_id, created_at")
      .eq("id", ctx.getUserId())
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? { id: ctx.getUserId() }, null, 2) }],
      structuredContent: { profile: data ?? { id: ctx.getUserId() } },
    };
  },
});
