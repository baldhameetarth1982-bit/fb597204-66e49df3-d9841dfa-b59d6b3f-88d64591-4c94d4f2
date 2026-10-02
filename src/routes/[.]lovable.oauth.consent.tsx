import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/shared/AuthShell";
import { Loader2, ShieldCheck } from "lucide-react";

type OAuthAPI = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function oauth(): OAuthAPI {
  // supabase.auth.oauth is beta; keep a tiny local type wrapper.
  return (supabase.auth as unknown as { oauth: OAuthAPI }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Client-only: session lives in localStorage, absent during SSR.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <AuthShell>
      <div className="p-4 text-sm text-destructive">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </div>
    </AuthShell>
  ),
});

function Consent() {
  const details = Route.useLoaderData() as any;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(null);
      setError(error.message ?? "Could not complete authorization");
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(null);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";
  const redirectUri = details?.client?.redirect_uri ?? details?.redirect_uri;

  return (
    <AuthShell>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">Authorize connection</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect {clientName} to your SociyoHub account
        </h1>
        <p className="text-sm text-muted-foreground">
          This lets {clientName} use SociyoHub as you. It can call the tools this app exposes
          (profile, your societies, your bills, notices) — subject to SociyoHub's row-level
          security. It cannot bypass your permissions.
        </p>
        {redirectUri && (
          <p className="text-xs text-muted-foreground break-all">
            Redirect URI: <span className="font-mono">{redirectUri}</span>
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => decide(false)}
            className="h-12 rounded-2xl"
          >
            {busy === "deny" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel connection
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => decide(true)}
            className="h-12 rounded-2xl"
          >
            {busy === "approve" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Approve
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
