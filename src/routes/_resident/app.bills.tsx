import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Receipt, Download, Clock, CheckCircle2, ArrowRight, Loader2, Home, IndianRupee } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FeeBreakdown } from "@/components/shared/FeeBreakdown";
import { cacheSet, cacheGet } from "@/lib/offline-cache";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { ClaimFlatSheet } from "@/components/resident/ClaimFlatSheet";
import { useServerFn } from "@tanstack/react-start";
import { createMaintenanceOrder } from "@/lib/maintenance-pay.functions";
import { openRazorpayForOrder } from "@/lib/razorpay";
import { toast } from "sonner";
import { TransactionSummaryModal } from "@/components/payments/TransactionSummaryModal";
import { PaymentSecurityBadge } from "@/components/payments/PaymentSecurityBadge";

export const Route = createFileRoute("/_resident/app/bills")({
  head: () => ({ meta: [{ title: "Bills — SocioHub" }] }),
  component: BillsScreen,
});

interface BillRow {
  id: string;
  title: string;
  amount: number;
  due: string;
  status: string;
}

function BillsScreen() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const createOrder = useServerFn(createMaintenanceOrder);
  const [visibleBills, setVisibleBills] = useState<BillRow[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [noFlat, setNoFlat] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payoutActive, setPayoutActive] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const isNowOnline = navigator.onLine;
      setOnline(isNowOnline);
      const cacheKey = profile?.id ? `bills:${profile.id}` : "bills";
      if (isNowOnline) {
        if (!profile?.id || !profile?.society_id) {
          setVisibleBills([]);
          setLoading(false);
          return;
        }
        const { data: flatRows } = await supabase
          .from("flat_residents")
          .select("flat_id")
          .eq("user_id", profile.id);
        const flatIds = (flatRows ?? []).map((r: any) => r.flat_id).filter(Boolean);
        if (!flatIds.length) {
          if (!cancelled) {
            setVisibleBills([]);
            setNoFlat(true);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) setNoFlat(false);
        const { data } = await supabase
          .from("bills")
          .select("id, period_label, amount, due_date, status")
          .eq("society_id", profile.society_id)
          .in("flat_id", flatIds)
          .order("due_date", { ascending: false })
          .limit(24);
        const rows = (data ?? []).map((b: any) => ({
          id: b.id,
          title: b.period_label ?? "Society bill",
          amount: Number(b.amount ?? 0),
          due: b.due_date ? new Date(b.due_date).toLocaleDateString() : "—",
          status: b.status ?? "unpaid",
        }));
        cacheSet(cacheKey, rows);
        if (!cancelled) setVisibleBills(rows);
      } else {
        setVisibleBills(cacheGet<BillRow[]>(cacheKey) ?? []);
      }
      if (!cancelled) setLoading(false);
    };
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [profile?.id, profile?.society_id]);

  useEffect(() => {
    if (!profile?.society_id) return;
    void (supabase as any).rpc("society_payout_active", { _society_id: profile.society_id }).then(({ data }: any) => {
      setPayoutActive(data === true);
    });
  }, [profile?.society_id]);

  const outstanding = visibleBills.find((b) => b.status === "unpaid" || b.status === "overdue" || b.status === "due");

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-5 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
        <p className="text-sm text-muted-foreground">Your maintenance & society dues{online ? "" : " · offline cache"}</p>
      </header>

      {noFlat && (
        <Card className="rounded-2xl border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 grid place-items-center shrink-0">
              <Home className="h-5 w-5 text-amber-700 dark:text-amber-200" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">You're not linked to a flat yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick your flat so bills can reach you. Your society admin will approve it.
              </p>
              <Button size="sm" className="mt-3 rounded-lg" onClick={() => setClaimOpen(true)}>
                Pick my flat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}


      <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 opacity-80">
            <p className="text-sm">Outstanding</p>
            {outstanding && <FeeBreakdown amount={outstanding.amount} />}
          </div>
          <p className="mt-1 text-4xl font-semibold tabular-nums">₹{(outstanding?.amount ?? 0).toLocaleString("en-IN")}</p>
          <p className="mt-1 text-xs opacity-80">{outstanding ? `Due ${outstanding.due}` : "No outstanding dues"}</p>
          <Button
            disabled={!outstanding || paying || !payoutActive}
            onClick={() => setSummaryOpen(true)}
            className="mt-5 w-full h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold disabled:opacity-60"
          >
            {paying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <IndianRupee className="h-4 w-4 mr-2" />}
            Pay now <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          {!payoutActive && outstanding && (
            <p className="mt-3 text-xs opacity-90">
              Your society admin hasn't enabled online payments yet. Please ask them to complete bank setup so you can pay.
            </p>
          )}
          {outstanding && payoutActive && (
            <p className="mt-3 text-[11px] opacity-80">
              Payment processing? Contact SocioHub Support for instant reconciliation.
            </p>
          )}
        </CardContent>
      </Card>

      {outstanding && (
        <PaymentSecurityBadge />
      )}

      {outstanding && (
        <TransactionSummaryModal
          open={summaryOpen}
          onOpenChange={(v) => (paying ? null : setSummaryOpen(v))}
          title="Transaction Summary"
          description={outstanding.title}
          lines={[
            { label: "Maintenance amount", amount: outstanding.amount },
            { label: "Platform fee (1.5%)", amount: Math.max(1, Math.round(outstanding.amount * 1.5) / 100), muted: true },
            { label: "Payable to society (98.5%)", amount: outstanding.amount - Math.max(0.01, Math.round(outstanding.amount * 1.5) / 100), muted: true },
          ]}
          total={outstanding.amount}
          busy={paying}
          confirmLabel="Pay Now"
          onConfirm={async () => {
            setPaying(true);
            try {
              const order = await createOrder({ data: { billId: outstanding.id } });
              if (!order.orderId || !order.keyId) throw new Error("Order failed");
              await openRazorpayForOrder({
                orderId: order.orderId,
                keyId: order.keyId,
                amount: order.amount,
                name: order.societyName ?? "SocioHub",
                description: order.label ?? "Maintenance bill",
                prefill: { email: profile?.email ?? undefined, contact: profile?.phone ?? undefined, name: profile?.full_name ?? undefined },
                onSuccess: async () => {
                  toast.success("Payment received — updating your bill…");
                  setSummaryOpen(false);
                  setTimeout(() => navigate({ to: "/app/bills" }), 1500);
                },
                onDismiss: () => setPaying(false),
              });
            } catch (e: any) {
              toast.error(e?.message ?? "Could not start payment");
            } finally {
              setPaying(false);
            }
          }}
        />
      )}

      <section>
        <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          History
        </h2>
        <div className="space-y-3">
          {visibleBills.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No bills found for your flat yet.
              </CardContent>
            </Card>
          ) : visibleBills.map((b) => {
            const paid = b.status === "paid" || b.status === "success";
            return (
              <Card key={b.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className={`h-11 w-11 rounded-xl grid place-items-center ${
                      paid ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {paid ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <Clock className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{b.title}</p>
                    <p className="text-xs text-muted-foreground">{b.due}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <p className="font-semibold tabular-nums">
                        ₹{b.amount.toLocaleString("en-IN")}
                      </p>
                      <FeeBreakdown amount={b.amount} />
                    </div>
                    {paid ? (
                      <Badge variant="secondary" className="mt-1 rounded-full text-[10px]">
                        Paid
                      </Badge>
                    ) : (
                      <Badge className="mt-1 rounded-full text-[10px] bg-primary text-primary-foreground">
                        Due
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Button variant="outline" className="w-full h-12 rounded-xl">
        <Download className="h-4 w-4 mr-2" /> Download statement
      </Button>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Receipt className="h-3.5 w-3.5" />
        Powered by SocioHub
      </div>

      {profile?.society_id && (
        <ClaimFlatSheet
          open={claimOpen}
          onOpenChange={setClaimOpen}
          societyId={profile.society_id}
        />
      )}
    </div>
  );
}
