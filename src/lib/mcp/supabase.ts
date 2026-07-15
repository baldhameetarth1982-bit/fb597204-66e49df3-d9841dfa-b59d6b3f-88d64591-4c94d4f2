import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Build a Supabase client that forwards the MCP caller's OAuth access token
 * as the Supabase session, so all queries run under RLS as that user.
 *
 * Uses the app's opaque `sb_publishable_*` key as `apikey`; strips the default
 * Bearer header so PostgREST accepts the user's access token instead.
 */
export function supabaseForMcpUser(ctx: ToolContext) {
  const url = process.env.SUPABASE_URL!;
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const token = ctx.getToken();
  return createClient(url, apikey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        // sb_ keys are opaque; send them only as apikey, not as Bearer.
        if (apikey.startsWith("sb_") && h.get("Authorization") === `Bearer ${apikey}`) {
          h.delete("Authorization");
        }
        h.set("apikey", apikey);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}
