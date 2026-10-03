import { logAiUsage, type AiUsageMeta } from "@/lib/ai-usage.server";
/**
 * Shared streaming caller for the Lovable AI Gateway Responses API (server only).
 * Returns the accumulated JSON text, or "" when the model refuses. Throws on HTTP/stream failure.
 */
export async function callResponsesJson(system: string, user: string, schemaName: string, schema: Record<string, unknown>, meta?: AiUsageMeta): Promise<string> {
  const t0 = Date.now();
  try {
    const out = await streamResponsesJson(system, user, schemaName, schema);
    if (meta) await logAiUsage(meta, out ? "ok" : "refused", t0);
    return out;
  } catch (e) {
    if (meta) await logAiUsage(meta, (e as { status?: number }).status === 429 ? "rate_limited" : "failed", t0);
    throw e;
  }
}

async function streamResponsesJson(system: string, user: string, schemaName: string, schema: Record<string, unknown>): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("ai_config");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: user,
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    }),
  });
  if (!res.ok || !res.body) throw Object.assign(new Error("ai_http"), { status: res.status });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
          if (ev.type === "response.refusal.delta") refused = true;
          if (ev.type === "response.failed" || ev.type === "error") throw new Error("ai_failed");
        } catch (e) {
          if ((e as Error).message === "ai_failed") throw e;
        }
      }
    }
  }
  return refused ? "" : out;
}
