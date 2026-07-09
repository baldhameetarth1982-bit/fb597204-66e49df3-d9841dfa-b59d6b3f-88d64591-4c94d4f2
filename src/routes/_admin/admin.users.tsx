import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Gift, Loader2, Crown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";

export const Route = createFileRoute("/_admin/admin/users")({
  head: () => ({ meta: [{ title: "Users — Super Admin" }] }),
  component: UsersPage,
});

interface Society {
  id: string;
  name: string;
  plan_id: string | null;
  plan_status: string;
  plan_expires_at: string | null;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"users" | "societies">("users");
  const [grantTarget, setGrantTarget] = useState<Society | null>(null);
  const [planId, setPlanId] = useState("pro");
  const [months, setMonths] = useState(12);

  const { data: users, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ["admin-users-all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) { toast.error(`Users: ${error.message}`); throw error; }
      return data ?? [];
    },
  });

  const { data: societies, error: societiesError } = useQuery({
    queryKey: ["admin-societies-all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_societies");
      if (error) { toast.error(`Societies: ${error.message}`); throw error; }
      return (data ?? []) as Society[];
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["admin-plans-list"],
    queryFn: async () =>
      (await supabase.from("plans").select("id, name, price_monthly_inr").order("sort_order")).data ?? [],
  });

  const grant = useMutation({
    mutationFn: async (vars: { society_id: string; plan_id: string; months: number }) => {
      const { error } = await supabase.rpc("admin_grant_society_plan", {
        _society_id: vars.society_id,
        _plan_id: vars.plan_id,
        _months: vars.months,
        _extend: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan granted successfully");
      qc.invalidateQueries({ queryKey: ["admin-users-all"] });
      qc.invalidateQueries({ queryKey: ["admin-societies-all"] });
      setGrantTarget(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to grant plan"),
  });

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users ?? [];
    return (users ?? []).filter((u: any) =>
      (u.full_name ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").toLowerCase().includes(q) ||
      (u.society_name ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  const filteredSocieties = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return societies ?? [];
    return (societies ?? []).filter((s) => s.name.toLowerCase().includes(q));
  }, [societies, search]);

  const withSociety = (users ?? []).filter((u: any) => u.society_id).length;

  return (
    <div className="min-h-dvh bg-muted/30 pb-24">
      <MobileHero
        eyebrow="Super Admin"
        title="People & societies"
        subtitle="Search every user. Grant plans for free to any society."
        icon={Users}
        variant="navy"
        stats={
          <StatPillRow>
            <StatPill label="Users" value={(users ?? []).length.toLocaleString("en-IN")} />
            <StatPill label="Onboarded" value={withSociety} />
            <StatPill label="Societies" value={(societies ?? []).length} />
            <StatPill label="Plans" value={(plans ?? []).length} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-card border shadow-sm p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, phone, society…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl border-0 bg-muted/60"
            />
          </div>
          <div className="grid grid-cols-2 rounded-2xl bg-muted p-1">
            {(["users", "societies"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-xl py-1.5 text-xs font-semibold capitalize transition ${
                  tab === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {(usersError || societiesError) && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {(usersError as any)?.message || (societiesError as any)?.message}
          </div>
        )}

        {tab === "users" ? (
          <SectionCard
            title="All users"
            description={`${filteredUsers.length} shown`}
            bodyClassName="p-0"
          >
            {usersLoading ? (
              <div className="py-12 grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No users match.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {filteredUsers.map((u: any) => (
                  <div key={u.id} className="p-4 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center">
                    <div className="h-10 w-10 rounded-2xl bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                      {initials(u.full_name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">
                          {u.full_name || "—"}
                        </span>
                        {u.society_id && u.plan_id && (
                          <StatusChip tone={u.plan_status === "active" ? "success" : "info"}>
                            {u.plan_id}
                          </StatusChip>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {u.email || u.phone || "—"}
                        {u.society_name && <> · {u.society_name}</>}
                      </div>
                    </div>
                    {u.society_id ? (
                      <Button
                        size="sm" variant="outline" className="rounded-full h-8 text-xs"
                        onClick={() => {
                          setGrantTarget({
                            id: u.society_id,
                            name: u.society_name ?? "Society",
                            plan_id: u.plan_id,
                            plan_status: u.plan_status,
                            plan_expires_at: u.plan_expires_at,
                          });
                          setPlanId(u.plan_id && u.plan_id !== "trial" ? u.plan_id : "pro");
                          setMonths(12);
                        }}
                      >
                        <Crown className="h-3.5 w-3.5 mr-1" />Grant
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No society</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard
            title="Societies"
            description={`${filteredSocieties.length} shown`}
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border/60">
              {filteredSocieties.map((s) => (
                <div key={s.id} className="p-4 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{s.name}</span>
                      <StatusChip tone={s.plan_status === "active" ? "success" : s.plan_status === "trialing" ? "info" : "neutral"}>
                        {s.plan_status}
                      </StatusChip>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      Plan {s.plan_id ?? "—"}
                      {s.plan_expires_at && <> · expires {new Date(s.plan_expires_at).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <Button
                    size="sm" className="rounded-full h-8 text-xs"
                    onClick={() => {
                      setGrantTarget(s);
                      setPlanId(s.plan_id && s.plan_id !== "trial" ? s.plan_id : "pro");
                      setMonths(12);
                    }}
                  >
                    <Gift className="h-3.5 w-3.5 mr-1" />Grant
                  </Button>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      <Dialog open={!!grantTarget} onOpenChange={(o) => !o && setGrantTarget(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Grant plan — {grantTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(plans ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.price_monthly_inr > 0 && `— ₹${p.price_monthly_inr}/mo`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration (months)</Label>
              <Input
                type="number" min={1} max={120} value={months}
                onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))}
                className="rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                Free grant — no payment required. Adds time on top of any current expiry.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setGrantTarget(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              onClick={() => grantTarget && grant.mutate({ society_id: grantTarget.id, plan_id: planId, months })}
              disabled={grant.isPending}
            >
              {grant.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Gift className="h-4 w-4 mr-1" />}
              Grant for free
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
