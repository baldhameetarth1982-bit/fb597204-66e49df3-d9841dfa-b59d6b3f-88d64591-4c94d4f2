import { createFileRoute, Link } from "@tanstack/react-router";
import { Wallet, ArrowRight, Check, Clock, IndianRupee, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

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
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);

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
          setLoading(false);
        }
        return;
      }
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
            asChild
            size="lg"
            disabled={!current}
            className="w-full bg-white text-primary hover:bg-white/90 rounded-xl font-semibold disabled:opacity-60"
          >
            <Link to="/app/bills">
              Pay now <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
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
        <Button asChild variant="ghost" className="w-full mt-2 text-xs">
          <Link to="/app/ledger">View full ledger →</Link>
        </Button>
      </div>
    </div>
  );
}
