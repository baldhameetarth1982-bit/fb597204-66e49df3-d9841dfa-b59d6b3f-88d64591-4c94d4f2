import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { MetricGroup } from "@/components/shared/MetricGroup";
import { StatusChip } from "@/components/system/StatusChip";
import { EmptyState } from "@/components/system/EmptyState";
import { ErrorState } from "@/components/system/ErrorState";
import { planName } from "@/lib/super-admin-ui";

export const Route = createFileRoute("/_admin/admin/users")({
  head: () => ({ meta: [{ title: "People & access — Super Admin" }, { name: "description", content: "Search every SociyoHub user and grant plans to their society." }] }),
  component: UsersPage,
});

interface GrantTarget { id: string; name: string; plan_id: string | null }

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<GrantTarget | null>(null);
  const [planId, setPlanId] = useState("pro");
  const [months, setMonths] = useState(12);
  const [reason, setReason] = useState("");

  const usersQ = useQuery({
    queryKey: ["admin-users-all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw new Error("load_failed");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const plansQ = useQuery({
    queryKey: ["admin-plans-grantable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("id, name, price_monthly_inr").order("sort_order");
      if (error) throw new Error("load_failed");
      return (data ?? []).filter((p) => !["trial", "ad_free", "resident"].includes(p.id));
    },
    staleTime: 60_000,
  });

  const grant = useMutation({
    mutationFn: async (v: { society_id: string; plan_id: string; months: number; reason: string }) => {
      const { error } = await supabase.rpc("admin_grant_society_plan", {
        _society_id: v.society_id, _plan_id: v.plan_id, _months: v.months, _extend: true, _reason: v.reason,
      });
      if (error) throw new Error(error.message.includes("reason_required") ? "A reason of at least 5 characters is required." : "Could not grant this plan. Please try again.");
    },
    onSuccess: () => {
      toast.success("Plan granted. Recorded in the audit history.");
      qc.invalidateQueries({ queryKey: ["admin-users-all"] });
      qc.invalidateQueries({ queryKey: ["admin-societies-v2"] });
      setTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const users = usersQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      [u.full_name, u.email, u.phone, u.society_name].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [users, search]);
  const onboarded = users.filter((u) => u.society_id).length;

  function openGrant(u: (typeof users)[number]) {
    setTarget({ id: u.society_id, name: u.society_name ?? "Society", plan_id: u.plan_id });
    setPlanId(u.plan_id && !["trial", "ad_free", "resident"].includes(u.plan_id) ? u.plan_id : "pro");
    setMonths(12);
    setReason("");
  }

  return (
    <PageShell>
      <PageHeader title="People & access" description="Find any user and grant a plan to their society. Society lifecycle lives on each society's page." />

      {usersQ.error ? (
        <ErrorState title="Couldn't load users" onRetry={() => usersQ.refetch()} showSupport={false} />
      ) : (
        <div className="space-y-6">
          <MetricGroup cols={3} items={[
            { label: "Users", value: usersQ.isLoading ? "—" : users.length.toLocaleString("en-IN"), icon: Users },
            { label: "In a society", value: usersQ.isLoading ? "—" : onboarded.toLocaleString("en-IN") },
            { label: "Not onboarded", value: usersQ.isLoading ? "—" : (users.length - onboarded).toLocaleString("en-IN") },
          ]} />

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search users" placeholder="Name, email, phone or society" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9" />
          </div>

          {usersQ.isLoading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users yet" description="People appear here once they sign up." />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {filtered.map((u) => (
                <li key={u.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary" aria-hidden>{initials(u.full_name)}</div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{u.full_name || "Unnamed user"}</span>
                      {u.society_id && u.plan_id && (
                        <StatusChip tone={u.plan_status === "active" ? "success" : "info"}>{planName(u.plan_id)}</StatusChip>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email || u.phone || "No contact"}
                      {u.society_id && u.society_name ? <> · <Link to="/admin/societies/$id" params={{ id: u.society_id }} className="underline-offset-2 hover:underline">{u.society_name}</Link></> : " · No society"}
                    </p>
                  </div>
                  {u.society_id && (
                    <Button variant="outline" className="col-span-2 h-11 rounded-xl sm:col-span-1" onClick={() => openGrant(u)}>
                      <Gift className="mr-1 h-4 w-4" /> Grant plan
                    </Button>
                  )}
                </li>
              ))}
              {filtered.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No users match "{search}".</li>}
            </ul>
          )}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && !grant.isPending && setTarget(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Grant a plan to {target?.name}</DialogTitle>
            <DialogDescription>Free grant with no payment. Time is added on top of any current expiry and recorded in the audit history.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(plansQ.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{Number(p.price_monthly_inr) > 0 ? ` — ₹${Number(p.price_monthly_inr).toLocaleString("en-IN")}/mo` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-months">Months</Label>
              <Input id="grant-months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Math.min(120, Math.max(1, Number(e.target.value) || 1)))} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-reason">Reason</Label>
              <Input id="grant-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pilot partner, 12 months free" className="h-11" />
              <p className="text-xs text-muted-foreground">At least 5 characters.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="h-11 rounded-xl" disabled={grant.isPending} onClick={() => setTarget(null)}>Cancel</Button>
            <Button className="h-11 rounded-xl" disabled={grant.isPending || reason.trim().length < 5 || !plansQ.data?.length}
              onClick={() => target && grant.mutate({ society_id: target.id, plan_id: planId, months, reason: reason.trim() })}>
              {grant.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Grant plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
