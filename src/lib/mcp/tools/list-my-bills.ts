import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForMcpUser } from "../supabase";
import { logMcpToolError, mcpErrorContent } from "../errors";

const MAX_LIMIT = 20;

export default defineTool({
  name: "list_my_bills",
  title: "List my bills",
  description:
    "List maintenance/other bills payable by the signed-in resident, most recent first.",
  inputSchema: {
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe("Max rows to return (default 10)."),
    status: z
      .enum(["paid", "unpaid", "pending", "overdue"])
      .optional()
      .describe("Optional status filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return mcpErrorContent("Not authenticated.");
    }
    const sb = supabaseForMcpUser(ctx);
    // Minimize: no payment proof, no bank reference, no reconciliation metadata,
    // no admin-only notes. Safe fields only, capped result count.
    let q = sb
      .from("bills")
      .select("id, period, amount, status, due_date")
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 10, MAX_LIMIT));
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      logMcpToolError("list_my_bills", error);
      return mcpErrorContent("Unable to load bills.");
    }
    const bills = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(bills, null, 2) }],
      structuredContent: { bills },
    };
  },
});
