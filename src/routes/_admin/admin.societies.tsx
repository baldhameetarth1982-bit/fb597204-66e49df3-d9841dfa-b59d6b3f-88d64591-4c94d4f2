import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Search, Loader2, Gift, Ban, RotateCcw, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/societies")({
  head: () => ({ meta: [{ title: "Societies — Super Admin" }] }),
  component: SocietiesPage,
});

type Society = {
  id: string; name: string; plan_id: string | null;
  plan_status: string; plan_expires_at: string | null;
  status: string; created_at: string;
};

function SocietiesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
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
    queryFn: async () => (await supabase.from("plans").select("id,name").order("sort_order")).data ?? [],
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s) || r.id.includes(s));
  }, [rows, q]);

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

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Societies</h1>
          <p className="text-sm text-muted-foreground">Manage every society across the platform.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or id…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.plan_id ?? "—"}</Badge>{" "}
                      <span className="text-xs text-muted-foreground">{r.plan_status}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "active" ? "default" : r.status === "suspended" ? "destructive" : "outline"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.plan_expires_at ? new Date(r.plan_expires_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => { setGrantFor(r); setPlanId(r.plan_id ?? "basic"); setMonths(1); }}>
                        <Gift className="h-3.5 w-3.5 mr-1" />Grant
                      </Button>
                      {r.status === "active" ? (
                        <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "suspended" })}>
                          <Ban className="h-3.5 w-3.5 mr-1" />Suspend
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "active" })}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Restore
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => resetInvite.mutate(r.id)}>
                        <KeyRound className="h-3.5 w-3.5 mr-1" />Invite
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No societies</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!grantFor} onOpenChange={(o) => !o && setGrantFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Grant / Extend plan — {grantFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Months</Label>
              <Input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantFor(null)}>Cancel</Button>
            <Button onClick={() => grantPlan.mutate()} disabled={grantPlan.isPending}>
              {grantPlan.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <Plus className="h-4 w-4 mr-1" />Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
