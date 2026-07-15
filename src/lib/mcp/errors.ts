/**
 * Safe server-side logging for MCP tool failures.
 *
 * Log only what helps operators triage — never the caller's access token,
 * the Authorization header, user PII, notice/bill bodies, or the raw
 * database error payload. Postgres/PostgREST error messages can leak
 * table names, column names, and constraint fragments; keep them off the
 * wire to MCP clients.
 */
export function logMcpToolError(tool: string, err: unknown): void {
  const code =
    (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined) ?? "unknown";
  // Intentionally do NOT include err.message / err.details / err.hint.
  console.warn(`[mcp:${tool}] tool failure code=${code}`);
}

/** Generic user-safe message returned to the MCP caller. */
export function mcpErrorContent(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
