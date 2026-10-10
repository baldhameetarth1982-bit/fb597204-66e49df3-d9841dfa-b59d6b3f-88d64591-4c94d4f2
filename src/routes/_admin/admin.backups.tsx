import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Download, Loader2, ReceiptText, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listAdminSaasSubscriptionPayments } from "@/lib/saas-subscription-lifecycle.functions";
import { userMessage } from "@/lib/user-error";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_admin/admin/backups")({
  head: () => ({ meta: [
    { title: "Backups & exports — Super Admin · SociyoHub" },
    { name: "description", content: "Download spreadsheet copies of platform societies, users and plan payments." },
    { property: "og:title", content: "Backups & exports — Super Admin · SociyoHub" },
    { property: "og:description", content: "Download spreadsheet copies of platform records." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: BackupsPage,
});

type Kind = "societies" | "users" | "payments";
type Cell = string | number;
const stamp = () => new Date().toISOString().slice(0, 10);
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function BackupsPage() {
  const listPayments = useServerFn(listAdminSaasSubscriptionPayments);
  const [busy, setBusy] = useState<Kind | null>(null);

  async function rowsFor(kind: Kind): Promise<Record<string, Cell>[]> {
    if (kind === "societies") {
      const { data, error } = await supabase.rpc("admin_society_health_list" as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        Name: s(r.name), City: s(r.city), Plan: s(r.plan_id), "Plan status": s(r.plan_status),
        "Plan ends": s(r.plan_expires_at), Status: s(r.status), Flats: Number(r.flats ?? 0),
        Residents: Number(r.residents ?? 0), Admins: Number(r.admins ?? 0), Guards: Number(r.guards ?? 0),
        Created: s(r.created_at),
      }));
    }
    if (kind === "users") {
      const { data, error } = await supabase.rpc("admin_list_users" as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        Name: s(r.full_name), Email: s(r.email), Phone: s(r.phone), Society: s(r.society_name),
        Roles: ((r.roles ?? []) as any[]).map((x) => x.role).join(", "), Joined: s(r.created_at),
      }));
    }
    const pays = (await listPayments()) as any[];
    return pays.map((p) => ({
      Society: s(p.societies?.name), Plan: s(p.plan_id), "Amount (INR)": Number(p.amount_paise ?? 0) / 100,
      Status: s(p.lifecycle_status), Created: s(p.created_at), Confirmed: s(p.confirmed_at),
      Refunded: s(p.refunded_at), Receipt: s(p.receipt?.receipt_number),
    }));
  }

  async function download(kind: Kind) {
    setBusy(kind);
    try {
      const rows = await rowsFor(kind);
      const { writeSafeWorkbook } = await import("@/lib/spreadsheet-safety");
      writeSafeWorkbook(rows.length ? rows : [{ Note: "No records" }], kind, `sociyohub-${kind}-${stamp()}.xlsx`);
      toast.success(tu("ln.bk.done"));
    } catch (e) {
      toast.error(userMessage(e as Error));
    } finally {
      setBusy(null);
    }
  }

  const items: { kind: Kind; label: string; icon: typeof Users }[] = [
    { kind: "societies", label: "ln.bk.societies", icon: Building2 },
    { kind: "users", label: "ln.bk.users", icon: Users },
    { kind: "payments", label: "ln.bk.payments", icon: ReceiptText },
  ];

  return (
    <PageShell>
      <PageHeader title={tu("ln.bk.nav")} description={tu("ln.bk.desc")} />
      <div className="mx-auto grid max-w-3xl gap-3">
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{tu("ln.bk.note")}</p>
        {items.map((it) => (
          <Card key={it.kind}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <it.icon className="h-5 w-5 text-primary" aria-hidden />
                <span className="font-medium">{tu(it.label)}</span>
              </div>
              <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => download(it.kind)}>
                {busy === it.kind ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
                {tu("ln.bk.download")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
