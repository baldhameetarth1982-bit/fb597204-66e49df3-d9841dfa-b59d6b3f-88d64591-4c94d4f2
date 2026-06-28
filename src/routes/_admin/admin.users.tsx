import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Gift, Loader2, Crown, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [grantTarget, setGrantTarget] = useState<Society | null>(null);
  const [planId, setPlanId] = useState("pro");
  const [months, setMonths] = useState(12);

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, created_at, society_id, societies(id, name, plan_id, plan_status, plan_expires_at)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: societies } = useQuery({
    queryKey: ["admin-societies-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("societies")
        .select("id, name, plan_id, plan_status, plan_expires_at")
        .order("name");
      return (data ?? []) as Society[];
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["admin-plans-list"],
    queryFn: async () => (await supabase.from("plans").select("id, name, price_monthly_inr").order("sort_order")).data ?? [],
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
      (u.societies?.name ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" /> All Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every user on the platform. Grant or upgrade plans for any society for free.
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, society…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
      </header>

      {/* Societies — quick grant */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Societies & Plans
            </h2>
            <Badge variant="outline">{societies?.length ?? 0} total</Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Society</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(societies ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell><Badge variant="secondary">{s.plan_id ?? "—"}</Badge></TableCell>
                    <TableCell>
                      <Badge className={
                        s.plan_status === "active" ? "bg-green-600" :
                        s.plan_status === "trialing" ? "bg-blue-600" : "bg-muted text-foreground"
                      }>{s.plan_status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.plan_expires_at ? new Date(s.plan_expires_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" className="rounded-lg" onClick={() => {
                        setGrantTarget(s);
                        setPlanId(s.plan_id && s.plan_id !== "trial" ? s.plan_id : "pro");
                        setMonths(12);
                      }}>
                        <Gift className="h-4 w-4 mr-1" /> Grant
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Users */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Users</h2>
            <Badge variant="outline">{filteredUsers.length} shown</Badge>
          </div>
          {usersLoading ? (
            <div className="py-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email / Phone</TableHead>
                    <TableHead>Society</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{u.email || "—"}</div>
                        {u.phone && <div className="text-muted-foreground">{u.phone}</div>}
                      </TableCell>
                      <TableCell>{u.societies?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {u.societies ? <Badge variant="secondary">{u.societies.plan_id ?? "—"}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {u.societies ? (
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => {
                            setGrantTarget(u.societies as Society);
                            setPlanId(u.societies.plan_id && u.societies.plan_id !== "trial" ? u.societies.plan_id : "pro");
                            setMonths(12);
                          }}>
                            <Crown className="h-4 w-4 mr-1" /> Grant plan
                          </Button>
                        ) : <span className="text-xs text-muted-foreground">No society</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!grantTarget} onOpenChange={(o) => !o && setGrantTarget(null)}>
        <DialogContent className="rounded-2xl">
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
            <Button variant="ghost" onClick={() => setGrantTarget(null)}>Cancel</Button>
            <Button
              onClick={() => grantTarget && grant.mutate({ society_id: grantTarget.id, plan_id: planId, months })}
              disabled={grant.isPending}
              className="rounded-xl"
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
