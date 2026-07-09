import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Search, Loader2, Gift, Ban, RotateCcw, KeyRound, Plus, MoreVertical,
} from "lucide-react";
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
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";

export const Route = createFileRoute("/_admin/admin/societies")({
  head: () => ({ meta: [{ title: "Societies — Super Admin" }] }),
  component: SocietiesPage,
});

type Society = {
  id: string; name: string; plan_id: string | null;
  plan_status: string; plan_expires_at: string | null;
  status: string; created_at: string;
};

type Filter = "all" | "active" | "trialing" | "suspended";

function statusTone(s: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (s === "active") return "success";
  if (s === "trialing") return "info";
  if (s === "suspended") return "danger";
  if (s === "expired") return "warning";
  return "neutral";
}

function SocietiesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [grantFor, setGrantFor] = useState<Society | null>(null);
  const [planId, setPlanId] = useState("basic");
  const [months, setMonths] = useState(1);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_societies");
      if (error) throw error;
      return (data ?? []) as Society[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["plans-min"],
    queryFn: async () =>
      (await supabase.from("plans").select("id,name").order("sort_order")).data ?? [],
  });

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, trialing: 0, suspended: 0 };
    for (const r of rows) {
      if (r.status === "suspended") c.suspended++;
      else if (r.plan_status === "active") c.active++;
      else if (r.plan_status === "trialing") c.trialing++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = rows;
    if (filter === "active") list = list.filter((r) => r.plan_status === "active" && r.status !== "suspended");
    else if (filter === "trialing") list = list.filter((r) => r.plan_status === "trialing");
    else if (filter === "suspended") list = list.filter((r) => r.status === "suspended");
    if (s) list = list.filter((r) => r.name.toLowerCase().includes(s) || r.id.includes(s));
    return list;
  }, [rows, q, filter]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("societies").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "suspended" ? "Society suspended" : "Society activated");
      qc.invalidateQueries({ queryKey: ["admin-societies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("regenerate_society_invite_code", { _society_id: id });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Invite code regenerated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const grantPlan = useMutation({
    mutationFn: async () => {
      if (!grantFor) return;
      const { error } = await supabase.rpc("admin_grant_society_plan", {
        _society_id: grantFor.id, _plan_id: planId, _months: months, _extend: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan granted");
      setGrantFor(null);
      qc.invalidateQueries({ queryKey: ["admin-societies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: "Active", count: counts.active },
    { key: "trialing", label: "Trial", count: counts.trialing },
    { key: "suspended", label: "Suspended", count: counts.suspended },
  ];

  return (
    <div className="min-h-dvh bg-muted/30 pb-24">
      <MobileHero
        eyebrow="Super Admin"
        title="Societies"
        subtitle="Every society on SocioHub — grant, suspend, restore, reset invites."
        icon={Building2}
        variant="navy"
        stats={
          <StatPillRow>
            <StatPill label="Total" value={counts.all} />
            <StatPill label="Active" value={counts.active} />
            <StatPill label="Trial" value={counts.trialing} />
            <StatPill label="Suspended" value={counts.suspended} />
          </StatPillRow>
        }
      />

      <div className="px-4 -mt-6 space-y-4 max-w-5xl mx-auto">
        <div className="rounded-3xl bg-card border shadow-sm p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-xl border-0 bg-muted/60"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                  filter === c.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>
        </div>

        <SectionCard
          title={filter === "all" ? "All societies" : chips.find((c) => c.key === filter)?.label}
          description={`${filtered.length} shown`}
          bodyClassName="p-0"
        >
          {isLoading ? (
            <div className="p-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No societies match.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((r) => (
                <div key={r.id} className="p-4 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{r.name}</span>
                      <StatusChip tone={statusTone(r.status === "suspended" ? "suspended" : r.plan_status)}>
                        {r.status === "suspended" ? "suspended" : r.plan_status}
                      </StatusChip>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      Plan <span className="font-medium text-foreground">{r.plan_id ?? "—"}</span>
                      {r.plan_expires_at && (
                        <> · expires {new Date(r.plan_expires_at).toLocaleDateString()}</>
                      )}
                      <> · joined {new Date(r.created_at).toLocaleDateString()}</>
                    </div>
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      <Button
                        size="sm" variant="outline" className="rounded-full h-8 text-xs"
                        onClick={() => { setGrantFor(r); setPlanId(r.plan_id ?? "basic"); setMonths(1); }}
                      >
                        <Gift className="h-3.5 w-3.5 mr-1" />Grant
                      </Button>
                      {r.status === "active" ? (
                        <Button
                          size="sm" variant="outline" className="rounded-full h-8 text-xs"
                          onClick={() => setStatus.mutate({ id: r.id, status: "suspended" })}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" />Suspend
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="outline" className="rounded-full h-8 text-xs"
                          onClick={() => setStatus.mutate({ id: r.id, status: "active" })}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Restore
                        </Button>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="rounded-full h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => resetInvite.mutate(r.id)}>
                        <KeyRound className="h-4 w-4 mr-2" />Reset invite code
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <Dialog open={!!grantFor} onOpenChange={(o) => !o && setGrantFor(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Grant / extend plan — {grantFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Months</Label>
              <Input
                type="number" min={1} max={120} value={months}
                onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))}
                className="rounded-xl mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setGrantFor(null)}>Cancel</Button>
            <Button
              className="rounded-xl"
              onClick={() => grantPlan.mutate()}
              disabled={grantPlan.isPending}
            >
              {grantPlan.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <Plus className="h-4 w-4 mr-1" />Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
