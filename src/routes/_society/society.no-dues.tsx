import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/no-dues")({
  head: () => ({ meta: [{ title: "No-Dues Certificates — SocioHub" }] }),
  component: NoDuesPage,
});

type Flat = {
  id: string;
  flat_number: string;
  blocks: { name: string } | null;
};

type Certificate = {
  id: string;
  flat_id: string;
  certificate_number: string;
  verification_token: string;
  status: "active" | "revoked" | "expired";
  issued_at: string;
  valid_until: string;
  revoked_at: string | null;
  revocation_reason: string | null;
};

type UnitRow = Flat & {
  outstanding: number;
  openTickets: number;
  certificate?: Certificate;
};

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function effectiveStatus(certificate: Certificate) {
  if (certificate.status === "active" && new Date(certificate.valid_until) < new Date()) {
    return "expired" as const;
  }
  return certificate.status;
}

function NoDuesPage() {
  const { societyId } = useSocietyId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UnitRow | null>(null);
  const [preview, setPreview] = useState<Certificate | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const { data, isLoading } = useQuery({
    enabled: Boolean(societyId),
    queryKey: ["no-dues-dashboard", societyId],
    queryFn: async () => {
      const [flatsResult, billsResult, paymentsResult, assignmentsResult, certificatesResult] =
        await Promise.all([
          supabase
            .from("flats")
            .select("id, flat_number, blocks(name)")
            .eq("society_id", societyId!)
            .order("flat_number"),
          supabase.from("bills").select("id, flat_id, amount, status").eq("society_id", societyId!),
          supabase.from("payments").select("bill_id, amount, status").eq("society_id", societyId!),
          supabase.from("flat_residents").select("flat_id, user_id").eq("is_active", true),
          (supabase as any)
            .from("no_dues_certificates")
            .select(
              "id, flat_id, certificate_number, verification_token, status, issued_at, valid_until, revoked_at, revocation_reason",
            )
            .eq("society_id", societyId!)
            .order("issued_at", { ascending: false }),
        ]);

      const firstError =
        flatsResult.error ||
        billsResult.error ||
        paymentsResult.error ||
        assignmentsResult.error ||
        certificatesResult.error;
      if (firstError) throw firstError;

      const assignments = (assignmentsResult.data ?? []) as Array<{
        flat_id: string;
        user_id: string;
      }>;
      const userIds = Array.from(new Set(assignments.map((item) => item.user_id)));
      const ticketsResult = userIds.length
        ? await supabase
            .from("support_tickets")
            .select("user_id, status")
            .in("user_id", userIds)
            .in("status", ["open", "in_progress"])
        : { data: [], error: null };
      if (ticketsResult.error) throw ticketsResult.error;

      const paidByBill = new Map<string, number>();
      for (const payment of paymentsResult.data ?? []) {
        if (payment.status !== "success") continue;
        paidByBill.set(
          payment.bill_id,
          (paidByBill.get(payment.bill_id) ?? 0) + Number(payment.amount),
        );
      }

      const outstandingByFlat = new Map<string, number>();
      for (const bill of billsResult.data ?? []) {
        if (bill.status === "cancelled") continue;
        const balance = Math.max(0, Number(bill.amount) - (paidByBill.get(bill.id) ?? 0));
        outstandingByFlat.set(bill.flat_id, (outstandingByFlat.get(bill.flat_id) ?? 0) + balance);
      }

      const ticketCountByUser = new Map<string, number>();
      for (const ticket of ticketsResult.data ?? []) {
        ticketCountByUser.set(ticket.user_id, (ticketCountByUser.get(ticket.user_id) ?? 0) + 1);
      }
      const ticketsByFlat = new Map<string, number>();
      for (const assignment of assignments) {
        ticketsByFlat.set(
          assignment.flat_id,
          (ticketsByFlat.get(assignment.flat_id) ?? 0) +
            (ticketCountByUser.get(assignment.user_id) ?? 0),
        );
      }

      const latestCertificate = new Map<string, Certificate>();
      for (const certificate of (certificatesResult.data ?? []) as Certificate[]) {
        if (!latestCertificate.has(certificate.flat_id)) {
          latestCertificate.set(certificate.flat_id, certificate);
        }
      }

      return ((flatsResult.data ?? []) as unknown as Flat[]).map((flat) => ({
        ...flat,
        outstanding: outstandingByFlat.get(flat.id) ?? 0,
        openTickets: ticketsByFlat.get(flat.id) ?? 0,
        certificate: latestCertificate.get(flat.id),
      }));
    },
  });

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data ?? [];
    return (data ?? []).filter((row) =>
      `${row.blocks?.name ?? ""} ${row.flat_number}`.toLowerCase().includes(normalized),
    );
  }, [data, query]);

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      eligible: all.filter((row) => row.outstanding === 0 && row.openTickets === 0).length,
      blocked: all.filter((row) => row.outstanding > 0 || row.openTickets > 0).length,
      active: all.filter((row) => row.certificate && effectiveStatus(row.certificate) === "active")
        .length,
    };
  }, [data]);

  const issueMutation = useMutation({
    mutationFn: async (flat: UnitRow) => {
      const { data: certificate, error } = await (supabase as any).rpc(
        "issue_no_dues_certificate",
        { _flat_id: flat.id, _valid_days: 30 },
      );
      if (error) throw error;
      return certificate as Certificate;
    },
    onSuccess: (certificate) => {
      toast.success("No-dues certificate issued");
      setSelected(null);
      setPreview(certificate);
      void queryClient.invalidateQueries({ queryKey: ["no-dues-dashboard", societyId] });
    },
    onError: (error: Error) => toast.error(error.message || "Certificate could not be issued"),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!revokeTarget) return;
      const { error } = await (supabase as any).rpc("revoke_no_dues_certificate", {
        _certificate_id: revokeTarget.id,
        _reason: revokeReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Certificate revoked");
      setRevokeTarget(null);
      setRevokeReason("");
      void queryClient.invalidateQueries({ queryKey: ["no-dues-dashboard", societyId] });
    },
    onError: (error: Error) => toast.error(error.message || "Certificate could not be revoked"),
  });

  function verificationUrl(certificate: Certificate) {
    if (typeof window === "undefined") return `/verify/no-dues/${certificate.verification_token}`;
    return `${window.location.origin}/verify/no-dues/${certificate.verification_token}`;
  }

  function downloadCertificate(certificate: Certificate, unit?: UnitRow) {
    const doc = new jsPDF();
    doc.setDrawColor(0, 71, 171);
    doc.setLineWidth(1.2);
    doc.rect(12, 12, 186, 273);
    doc.setTextColor(0, 71, 171);
    doc.setFontSize(24);
    doc.text("NO-DUES CERTIFICATE", 105, 45, { align: "center" });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(11);
    doc.text(`Certificate: ${certificate.certificate_number}`, 105, 58, { align: "center" });
    doc.setFontSize(14);
    const unitName = unit
      ? `${unit.blocks?.name ? `${unit.blocks.name} · ` : ""}${unit.flat_number}`
      : "Verified society unit";
    doc.text(`This certifies that ${unitName} had no outstanding society dues`, 105, 100, {
      align: "center",
      maxWidth: 160,
    });
    doc.text("and no unresolved requests when this certificate was issued.", 105, 112, {
      align: "center",
    });
    doc.setFontSize(11);
    doc.text(`Issued: ${new Date(certificate.issued_at).toLocaleDateString("en-IN")}`, 30, 150);
    doc.text(
      `Valid until: ${new Date(certificate.valid_until).toLocaleDateString("en-IN")}`,
      30,
      162,
    );
    doc.text("Verify this certificate online:", 30, 198);
    doc.setTextColor(0, 71, 171);
    doc.text(verificationUrl(certificate), 30, 207, { maxWidth: 150 });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.text("Digitally generated by SocioHub. No physical signature is required.", 105, 260, {
      align: "center",
    });
    doc.save(`${certificate.certificate_number}.pdf`);
  }

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Compliance automation"
        title="No-dues certificates"
        subtitle="Automatic eligibility checks, digital issuance, QR verification, and revocation history."
        icon={BadgeCheck}
        variant="teal"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-4 pt-4 md:px-8">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Eligible" value={counts.eligible} tone="success" />
          <Metric label="Blocked" value={counts.blocked} tone="danger" />
          <Metric label="Active certificates" value={counts.active} tone="primary" />
        </div>

        <SectionCard
          title="Unit eligibility"
          description="A unit must have ₹0 outstanding and no unresolved tickets."
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search block or unit…"
              className="h-11 rounded-xl pl-9"
            />
          </div>
        </SectionCard>

        {isLoading ? (
          <div className="grid place-items-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No matching units found.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => {
              const eligible = row.outstanding === 0 && row.openTickets === 0;
              const status = row.certificate ? effectiveStatus(row.certificate) : null;
              return (
                <Card key={row.id} className="rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold">
                              {row.blocks?.name ? `${row.blocks.name} · ` : ""}
                              {row.flat_number}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {money(row.outstanding)} outstanding · {row.openTickets} open tickets
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                              eligible
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-rose-500/10 text-rose-700 dark:text-rose-400",
                            )}
                          >
                            {eligible ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {eligible ? "Eligible" : "Blocked"}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {row.certificate && status === "active" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => setPreview(row.certificate!)}
                              >
                                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> View active
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="rounded-xl text-destructive"
                                onClick={() => setRevokeTarget(row.certificate!)}
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" /> Revoke
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              className="rounded-xl"
                              disabled={!eligible}
                              onClick={() => setSelected(row)}
                            >
                              <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Issue certificate
                            </Button>
                          )}
                          {status && status !== "active" && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock3 className="h-3.5 w-3.5" /> Previous: {status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue no-dues certificate?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            SocioHub will re-check bills, successful payments, and unresolved tickets inside the
            database. The certificate will remain verifiable for 30 days.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              disabled={!selected || issueMutation.isPending}
              onClick={() => selected && issueMutation.mutate(selected)}
            >
              {issueMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Check and issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Digital certificate</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="rounded-2xl border-2 border-primary/30 p-5 text-center">
              <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
              <h3 className="mt-3 text-xl font-bold">No-Dues Certificate</h3>
              <p className="mt-1 text-xs text-muted-foreground">{preview.certificate_number}</p>
              <div className="mx-auto mt-5 w-fit rounded-xl bg-white p-3">
                <QRCodeSVG value={verificationUrl(preview)} size={132} level="M" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Valid until {new Date(preview.valid_until).toLocaleDateString("en-IN")}
              </p>
              <Button className="mt-5 rounded-xl" onClick={() => downloadCertificate(preview)}>
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke certificate</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revocation-reason">Reason</Label>
            <Input
              id="revocation-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              maxLength={300}
              placeholder="Example: payment reversed after issuance"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeReason.trim().length < 3 || revokeMutation.isPending}
              onClick={() => revokeMutation.mutate()}
            >
              {revokeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revoke permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "primary";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3 text-center",
        tone === "success" && "border-emerald-500/20 bg-emerald-500/5",
        tone === "danger" && "border-rose-500/20 bg-rose-500/5",
        tone === "primary" && "border-primary/20 bg-primary/5",
      )}
    >
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
