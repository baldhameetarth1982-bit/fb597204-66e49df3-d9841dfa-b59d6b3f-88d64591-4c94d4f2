import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForMcpUser } from "../supabase";

export default defineTool({
  name: "list_my_bills",
  title: "List my bills",
  description:
    "List maintenance/other bills payable by the signed-in resident, most recent first.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max rows to return (default 20)."),
    status: z
      .enum(["paid", "unpaid", "pending", "overdue"])
      .optional()
      .describe("Optional status filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const sb = supabaseForMcpUser(ctx);
    let q = sb
      .from("bills")
      .select("id, society_id, flat_id, period, amount, status, due_date, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { bills: data ?? [] },
    };
  },
});
