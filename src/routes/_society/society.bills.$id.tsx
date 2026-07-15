import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2, ArrowLeft, Receipt, IndianRupee, Calendar, Home,
  CheckCircle2, Clock, XCircle, FileDown, Share2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { toast } from "sonner";
import { shareBillAsImage } from "@/components/billing/BillCardImage";
import { formatCurrency, formatDate } from "@/utils/format";

export const Route = createFileRoute("/_society/society/bills/$id")({
  head: () => ({ meta: [{ title: "Bill Detail — SociyoHub" }] }),
  component: BillDetailPage,
});

interface BillDetail {
  id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string;
  period_label: string;
  amount: number;
  status: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  flat_id: string;
  society_id: string;
  flat?: { flat_number: string; block_name?: string | null } | null;
  society?: { name: string | null } | null;
  resident?: { full_name: string | null; phone: string | null } | null;
  payments?: Array<{ id: string; amount: number; status: string; created_at: string; method?: string | null }>;
}

function BillDetailPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("bills")
        .select("id, bill_number, bill_date, due_date, period_label, amount, status, paid_at, cancelled_at, cancel_reason, notes, flat_id, society_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        if (!cancelled) { setLoading(false); toast.error(error?.message ?? "Bill not found"); }
        return;
      }
      const b: BillDetail = data as any;

      const [flatRes, societyRes, residentRes, paymentRes] = await Promise.all([
        supabase.from("flats").select("flat_number, block_id").eq("id", b.flat_id).maybeSingle(),
        supabase.from("societies").select("name").eq("id", b.society_id).maybeSingle(),
        supabase.from("flat_residents")
          .select("user_id")
          .eq("flat_id", b.flat_id)
          .is("moved_out_at", null)
          .limit(1)
          .maybeSingle(),
        supabase.from("payments")
          .select("id, amount, status, created_at, method")
          .eq("bill_id", b.id)
          .order("created_at", { ascending: true }),
      ]);

      let block_name: string | null = null;
      if (flatRes.data?.block_id) {
        const { data: blk } = await supabase.from("blocks").select("name").eq("id", flatRes.data.block_id).maybeSingle();
        block_name = blk?.name ?? null;
      }
      let resident: BillDetail["resident"] = null;
      if (residentRes.data?.user_id) {
        const { data: prof } = await supabase.from("profiles").select("full_name, phone").eq("id", residentRes.data.user_id).maybeSingle();
        resident = prof as any;
      }

      b.flat = flatRes.data ? { flat_number: flatRes.data.flat_number, block_name } : null;
      b.society = societyRes.data as any;
      b.resident = resident;
      b.payments = (paymentRes.data as any) ?? [];
      if (!cancelled) { setBill(b); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!bill) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Bill not found.</p>
        <Button asChild variant="ghost" className="mt-4"><Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link></Button>
      </PageShell>
    );
  }

  const flatLabel = `${bill.flat?.block_name ? bill.flat.block_name + "-" : ""}${bill.flat?.flat_number ?? "—"}`;
  const statusTone =
    bill.status === "paid" ? "success" :
    bill.status === "cancelled" ? "neutral" :
    (new Date(bill.due_date) < new Date() ? "danger" : "warning");

  const successfulPayment = bill.payments?.find((p) => p.status === "success" || p.status === "captured");

  // Real timeline events only
  const timeline: Array<{ label: string; date: string; icon: any; tone: "primary" | "success" | "danger" | "neutral" }> = [];
  timeline.push({ label: "Bill generated", date: bill.bill_date, icon: Receipt, tone: "primary" });
  (bill.payments ?? []).forEach((p) => {
    if (p.status === "success" || p.status === "captured") {
      timeline.push({ label: `Payment successful${p.method ? ` (${p.method})` : ""}`, date: p.created_at, icon: CheckCircle2, tone: "success" });
    } else if (p.status === "failed") {
      timeline.push({ label: "Payment failed", date: p.created_at, icon: XCircle, tone: "danger" });
    } else {
      timeline.push({ label: `Payment ${p.status}`, date: p.created_at, icon: Clock, tone: "neutral" });
    }
  });
  if (bill.cancelled_at) timeline.push({ label: `Cancelled${bill.cancel_reason ? ` — ${bill.cancel_reason}` : ""}`, date: bill.cancelled_at, icon: XCircle, tone: "danger" });

  return (
    <PageShell>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="rounded-lg -ml-2">
          <Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-1" />Billing Center</Link>
        </Button>
      </div>

      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {bill.bill_number ?? "Bill"}
              </p>
              <h1 className="text-xl font-semibold">{bill.period_label}</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" />{flatLabel}
                {bill.resident?.full_name && <> · {bill.resident.full_name}</>}
              </p>
            </div>
            <StatusChip tone={statusTone}>{bill.status.toUpperCase()}</StatusChip>
          </div>

          <div className="mt-5 flex items-baseline gap-1">
            <IndianRupee className="h-5 w-5 text-muted-foreground" />
            <span className="text-3xl font-bold">{Number(bill.amount).toLocaleString("en-IN")}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Generated</p>
              <p className="font-medium">{formatDate(bill.bill_date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due date</p>
              <p className="font-medium">{formatDate(bill.due_date)}</p>
            </div>
            {bill.paid_at && (
              <div>
                <p className="text-xs text-muted-foreground">Paid on</p>
                <p className="font-medium">{formatDate(bill.paid_at)}</p>
              </div>
            )}
            {bill.resident?.phone && (
              <div>
                <p className="text-xs text-muted-foreground">Mobile</p>
                <p className="font-medium">{bill.resident.phone}</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-xl"
              onClick={async () => {
                try {
                  await shareBillAsImage({
                    societyName: bill.society?.name ?? "Society",
                    flatLabel,
                    residentName: bill.resident?.full_name ?? undefined,
                    period: bill.period_label,
                    amount: Number(bill.amount),
                    dueDate: formatDate(bill.due_date),
                    status: (bill.status as any) || "due",
                    adminSignature: user?.email?.split("@")[0],
                  });
                } catch (e: any) { toast.error(e?.message ?? "Could not share"); }
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />Share
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => window.print()}
            >
              <FileDown className="h-4 w-4 mr-2" />Print / PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {successfulPayment && (
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Payment</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{formatCurrency(Number(successfulPayment.amount))}</p>
                <p className="text-xs text-muted-foreground">{formatDate(successfulPayment.created_at)}{successfulPayment.method ? ` · ${successfulPayment.method}` : ""}</p>
              </div>
              <StatusChip tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Received</StatusChip>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Timeline</p>
          <ol className="space-y-4">
            {timeline.map((t, i) => {
              const Icon = t.icon;
              const toneClass =
                t.tone === "success" ? "bg-success-container text-success-container-foreground" :
                t.tone === "danger" ? "bg-danger-container text-danger-container-foreground" :
                t.tone === "primary" ? "bg-primary/10 text-primary" :
                "bg-muted text-muted-foreground";
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className={`h-8 w-8 rounded-full grid place-items-center shrink-0 ${toneClass}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(t.date)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </PageShell>
  );
}
