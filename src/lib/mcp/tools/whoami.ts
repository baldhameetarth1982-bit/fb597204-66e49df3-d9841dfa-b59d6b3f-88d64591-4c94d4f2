import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForMcpUser } from "../supabase";
import { logMcpToolError, mcpErrorContent } from "../errors";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return a minimal profile of the currently signed-in SociyoHub user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return mcpErrorContent("Not authenticated.");
    }
    const sb = supabaseForMcpUser(ctx);
    // Minimize: id + display name only. No phone, no email, no address,
    // no DOB, no private profile metadata, no society secret config.
    const { data, error } = await sb
      .from("profiles")
      .select("id, full_name")
      .eq("id", ctx.getUserId())
      .maybeSingle();
    if (error) {
      logMcpToolError("whoami", error);
      return mcpErrorContent("Unable to load your profile.");
    }
    const profile = {
      id: data?.id ?? ctx.getUserId(),
      full_name: data?.full_name ?? null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
      structuredContent: { profile },
    };
  },
});
