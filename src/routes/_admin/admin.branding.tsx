import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Palette, Loader2, Building2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/branding")({
  head: () => ({ meta: [{ title: "Branding — Super Admin" }] }),
  component: BrandingPage,
});

function BrandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-branding"],
    queryFn: async () => {
      const { data } = await supabase
        .from("societies")
        .select("id, name, logo_url, bill_theme, signature_url, plan_id, status")
        .order("name");
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      withLogo: rows.filter((r: any) => r.logo_url).length,
      withSignature: rows.filter((r: any) => r.signature_url).length,
    };
  }, [data]);

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <Palette className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">White-label & Branding</h1>
          <p className="text-sm text-muted-foreground">Per-society branding foundation for enterprise / white-label rollouts.</p>
        </div>
      </header>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat title="Societies" value={stats.total} />
        <Stat title="With logo" value={stats.withLogo} />
        <Stat title="With signature" value={stats.withSignature} />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h2 className="font-semibold mb-2">White-label foundation</h2>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
            <li>Every society already carries <code>logo_url</code>, <code>bill_theme</code> and business identity fields.</li>
            <li>Bill themes render on generated PDFs; new themes plug in without codebase forks.</li>
            <li>Custom domains / organization layer route through the same single codebase — no second app.</li>
            <li>Feature toggles are enforced at plan-level via <code>society_has_access</code>.</li>
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
                  <TableHead>Society</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Logo</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Bill theme</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      {r.logo_url ? (
                        <img src={r.logo_url} alt="" className="h-6 w-6 rounded object-cover" />
                      ) : (
                        <div className="h-6 w-6 rounded bg-muted grid place-items-center"><Building2 className="h-3 w-3 text-muted-foreground" /></div>
                      )}
                      {r.name}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{r.plan_id ?? "—"}</Badge></TableCell>
                    <TableCell>{r.logo_url ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}</TableCell>
                    <TableCell>{r.signature_url ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}</TableCell>
                    <TableCell className="text-xs">{r.bill_theme ?? "classic"}</TableCell>
                    <TableCell><Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge></TableCell>
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

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
