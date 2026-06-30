import { createFileRoute } from "@tanstack/react-router";
import { Wallet, ArrowRight, Check, Clock, IndianRupee, Loader2, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ClaimFlatSheet } from "@/components/resident/ClaimFlatSheet";
import { useServerFn } from "@tanstack/react-start";
import { createMaintenanceOrder } from "@/lib/maintenance-pay.functions";
import { openRazorpayForOrder } from "@/lib/razorpay";
import { toast } from "sonner";

export const Route = createFileRoute("/_resident/app/dues")({
  head: () => ({ meta: [{ title: "Dues — SocioHub" }] }),
  component: DuesPage,
});

interface BillItem {
  id: string;
  month: string;
  amount: number;
  dueDate: string;
  paid: boolean;
}

function DuesPage() {
  const { profile } = useAuth();
  const createOrder = useServerFn(createMaintenanceOrder);
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [noFlat, setNoFlat] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payoutActive, setPayoutActive] = useState(false);

  useEffect(() => {
    if (!profile?.society_id) return;
    void (supabase as any).rpc("society_payout_active", { _society_id: profile.society_id }).then(({ data }: any) => {
      setPayoutActive(data === true);
    });
  }, [profile?.society_id]);

  async function handlePay() {
    if (!current) return;
    setPaying(true);
    try {
      const order = await createOrder({ data: { billId: current.id } });
      if (!order.orderId || !order.keyId) throw new Error("Order failed");
      await openRazorpayForOrder({
        orderId: order.orderId,
        keyId: order.keyId,
        amount: order.amount,
        name: order.societyName ?? "SocioHub",
        description: order.label ?? "Maintenance bill",
        prefill: { email: profile?.email ?? undefined, contact: profile?.phone ?? undefined, name: profile?.full_name ?? undefined },
        onSuccess: () => { toast.success("Payment received — updating bill…"); setTimeout(() => window.location.reload(), 1500); },
        onDismiss: () => setPaying(false),
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start payment");
    } finally { setPaying(false); }
  }


  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!profile?.id || !profile?.society_id) {
        setBills([]);
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
          setBills([]);
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
      if (!cancelled) {
        setBills((data ?? []).map((b: any) => ({
          id: b.id,
          month: b.period_label ?? "Society bill",
          amount: Number(b.amount ?? 0),
          dueDate: b.due_date ? new Date(b.due_date).toLocaleDateString() : "—",
          paid: b.status === "paid" || b.status === "success",
        })));
        setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.society_id]);

  const current = bills.find((b) => !b.paid);
  const history = bills.filter((b) => b.paid);

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dues & Payments</h1>
          <p className="text-xs text-muted-foreground">Your maintenance bills</p>
        </div>
      </div>

      {noFlat && (
        <Card className="rounded-2xl border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 grid place-items-center shrink-0">
              <Home className="h-5 w-5 text-amber-700 dark:text-amber-200" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">You're not linked to a flat yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick your flat so bills can reach you.
              </p>
              <Button size="sm" className="mt-3 rounded-lg" onClick={() => setClaimOpen(true)}>
                Pick my flat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current bill */}
      <Card className="rounded-2xl border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-90">{current?.month ?? "No current bill"}</span>
            <Badge className="bg-white/20 text-white border-0 rounded-full text-[10px]">
              <Clock className="h-3 w-3 mr-1" />
              {current ? `Due ${current.dueDate}` : "Clear"}
            </Badge>
          </div>
          <div className="flex items-baseline gap-1">
            <IndianRupee className="h-6 w-6" />
            <span className="text-4xl font-bold tracking-tight">
              {(current?.amount ?? 0).toLocaleString("en-IN")}
            </span>
          </div>
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs opacity-90">
              <span>{current ? "Outstanding amount" : "Status"}</span>
              <span>{current ? `₹${current.amount.toLocaleString("en-IN")}` : "No dues"}</span>
            </div>
          </div>
          <Button
            size="lg"
            disabled={!current || paying || !payoutActive}
            onClick={handlePay}
            className="w-full bg-white text-primary hover:bg-white/90 rounded-xl font-semibold disabled:opacity-60"
          >
            {paying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Pay now <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          {!payoutActive && current && (
            <p className="mt-3 text-[11px] opacity-90 text-center">
              Your society admin hasn't enabled online payments yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold mb-2 px-1">Payment history</h2>
        <div className="space-y-2">
          {history.length === 0 ? (
            <Card className="rounded-xl">
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                No payment history yet.
              </CardContent>
            </Card>
          ) : history.map((h) => (
            <Card key={h.id} className="rounded-xl">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-emerald-100 grid place-items-center">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{h.month}</p>
                  <p className="text-[11px] text-muted-foreground">Due {h.dueDate}</p>
                </div>
                <span className="text-sm font-semibold">
                  ₹{h.amount.toLocaleString("en-IN")}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
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
