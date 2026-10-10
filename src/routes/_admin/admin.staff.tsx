import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState } from "@/components/system/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/user-error";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_admin/admin/staff")({
  head: () => ({ meta: [
    { title: "Staff roles — Super Admin · SociyoHub" },
    { name: "description", content: "Give platform team members access to only the Super Admin areas they need." },
    { property: "og:title", content: "Staff roles — Super Admin · SociyoHub" },
    { property: "og:description", content: "Operations, Finance, Marketing and Support access for the platform team." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: StaffPage,
});

const ROLES = [
  { id: "operations", label: "ln.stf.ops", hint: "ln.stf.opsHint" },
  { id: "finance", label: "ln.stf.fin", hint: "ln.stf.finHint" },
  { id: "marketing", label: "ln.stf.mkt", hint: "ln.stf.mktHint" },
  { id: "support", label: "ln.stf.sup", hint: "ln.stf.supHint" },
] as const;
const labelOf = (r: string) => tu(ROLES.find((x) => x.id === r)?.label ?? r);
const RESULT: Record<string, string> = {
  user_not_found: "ln.stf.notFound", email_ambiguous: "ln.stf.ambiguous", already_super_admin: "ln.stf.isSuper",
};

type Staff = { user_id: string; full_name: string | null; email: string | null; roles: string[] };

function StaffPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("operations");
  const list = useQuery({
    queryKey: ["platform-staff"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_list_platform_staff");
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform-staff"] });
  const grant = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_grant_platform_role", { _email: email.trim(), _role: role });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (r) => {
      if (r === "ok") { toast.success(tu("ln.stf.added")); setEmail(""); refresh(); }
      else toast.error(tu(RESULT[r] ?? "ln.stf.notFound"));
    },
    onError: (e: Error) => toast.error(userMessage(e)),
  });
  const revoke = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { user: string; role: string }) => {
      const { error } = await (supabase.rpc as any)("admin_revoke_platform_role", { _user_id: v.user, _role: v.role });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(userMessage(e)),
  });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <PageShell>
      <PageHeader title={tu("ln.stf.nav")} description={tu("ln.stf.desc")} />
      <div className="mx-auto grid max-w-3xl gap-5">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <Label htmlFor="stf-email">{tu("ln.stf.email")}</Label>
                <Input id="stf-email" type="email" autoComplete="off" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>{tu("ln.stf.role")}</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r.id} value={r.id}>{tu(r.label)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {ROLES.map((r) => <li key={r.id}><span className="font-medium text-foreground">{tu(r.label)}:</span> {tu(r.hint)}</li>)}
            </ul>
            <Button className="min-h-11" disabled={!emailOk || grant.isPending} onClick={() => grant.mutate()}>
              {grant.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {tu("ln.stf.add")}
            </Button>
            <p className="text-xs text-muted-foreground">{tu("ln.stf.note")}</p>
          </CardContent>
        </Card>

        {list.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <ErrorState onRetry={() => list.refetch()} showSupport={false} />
        ) : !list.data?.length ? (
          <p className="text-center text-sm text-muted-foreground">{tu("ln.stf.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {list.data.map((s) => (
              <li key={s.user_id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.full_name || s.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="gap-1 pe-1">
                          {labelOf(r)}
                          <button
                            type="button"
                            aria-label={`${tu("ln.stf.remove")} ${labelOf(r)}`}
                            className="grid h-6 w-6 place-items-center rounded-full hover:bg-muted"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate({ user: s.user_id, role: r })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
