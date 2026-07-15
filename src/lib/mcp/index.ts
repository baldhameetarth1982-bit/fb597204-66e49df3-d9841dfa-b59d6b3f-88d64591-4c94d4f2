import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listMySocietiesTool from "./tools/list-my-societies";
import listMyBillsTool from "./tools/list-my-bills";
import listNoticesTool from "./tools/list-notices";

// OAuth issuer MUST be the direct Supabase host (not the .lovable.cloud proxy),
// or mcp-js rejects tokens on RFC 8414 issuer mismatch. Derived from the project
// ref which Vite inlines at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sociyohub-mcp",
  title: "SociyoHub",
  version: "0.1.0",
  instructions:
    "Read-only tools for SociyoHub — the signed-in resident/admin's profile, societies, bills, and notices. All calls run under Supabase RLS as the authenticated user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listMySocietiesTool, listMyBillsTool, listNoticesTool],
});
