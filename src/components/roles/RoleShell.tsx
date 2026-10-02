import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, LogOut, RotateCw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { getMyRoleAccess, type MyRoleAccess } from "@/lib/role-access.functions";

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}

export function ErrorRow({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <span className="flex-1">{errText(error)}</span>
      {onRetry && <Button size="sm" variant="outline" className="min-h-11" onClick={onRetry}><RotateCw className="mr-1 h-4 w-4" />Try again</Button>}
    </div>
  );
}

function FullState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-6 text-center">
      <div className="space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-destructive/10"><ShieldOff className="h-6 w-6 text-destructive" aria-hidden /></div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex justify-center gap-2">
          {onRetry && <Button variant="outline" className="min-h-11" onClick={onRetry}><RotateCw className="mr-1 h-4 w-4" />Check again</Button>}
          <Button className="min-h-11" onClick={async () => { await signOut(); window.location.replace("/login"); }}><LogOut className="mr-1 h-4 w-4" />Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps the Auditor / Staff experience. The role is re-checked on the server on
 * load, every minute and on focus, so a revoked or deactivated role stops working
 * even if this browser still remembers it. Every action is also re-checked server-side.
 */
export function RoleShell({ role, children }: { role: "auditor" | "staff"; children: (access: MyRoleAccess["roles"][number], societyName: string | null) => ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const fn = useServerFn(getMyRoleAccess);
  const q = useQuery({
    queryKey: ["my-role-access"], enabled: isAuthenticated, queryFn: () => fn(),
    refetchInterval: 60_000, refetchOnWindowFocus: true, retry: 1, staleTime: 30_000,
  });

  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (q.isLoading) return <Loading label="Checking your access…" />;
  if (q.error) {
    const msg = errText(q.error);
    if (/session|jwt|unauthor/i.test(msg)) return <FullState title="Session expired" body="Please sign in again to continue." />;
    return <FullState title="Couldn't check your access" body={msg} onRetry={() => q.refetch()} />;
  }
  const access = q.data?.roles.find((r) => r.role === role);
  if (!access) {
    return <FullState title="Access not active" body={role === "auditor"
      ? "You don't have active auditor access to this society. It may have been removed by the committee."
      : "You don't have active staff access to this society. It may have been removed or your staff record made inactive."}
      onRetry={() => q.refetch()} />;
  }
  return <>{children(access, q.data?.society_name ?? null)}</>;
}
