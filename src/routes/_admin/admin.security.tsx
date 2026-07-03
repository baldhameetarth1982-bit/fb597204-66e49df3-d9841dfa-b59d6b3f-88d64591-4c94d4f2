import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Users, Building2, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/security")({
  head: () => ({ meta: [{ title: "Security — Super Admin" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, society_id, block_id, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const grouped = roles.reduce<Record<string, number>>((acc, r: any) => {
    acc[r.role] = (acc[r.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Security Center</h1>
          <p className="text-sm text-muted-foreground">Roles, permissions and sensitive access.</p>
        </div>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric title="Super Admins" value={grouped["super_admin"] ?? 0} icon={Crown} />
        <Metric title="Society Admins" value={grouped["society_admin"] ?? 0} icon={Building2} />
        <Metric title="Block Admins" value={grouped["block_admin"] ?? 0} icon={Building2} />
        <Metric title="Residents" value={grouped["resident"] ?? 0} icon={Users} />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3">Security posture</h2>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
            <li>Row-Level Security enforced on every public table.</li>
            <li>Role checks isolated to <code>has_role()</code> security-definer function.</li>
            <li>Server-side validation on subscription, payment and billing writes.</li>
            <li>Tenant isolation via <code>society_id</code> RLS scoping.</li>
            <li>Aadhaar / KYC uploads guarded by dedicated definer RPCs.</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Society</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((r: any) => (
                  <TableRow key={`${r.user_id}-${r.role}-${r.society_id ?? ""}-${r.block_id ?? ""}`}>
                    <TableCell><Badge>{r.role}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.user_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.society_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.block_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, icon: Icon }: { title: string; value: number; icon: any }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
