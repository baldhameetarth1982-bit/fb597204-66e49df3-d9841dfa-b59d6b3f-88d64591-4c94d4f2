import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Receipt, Download, Clock, CheckCircle2, ArrowRight, Fingerprint, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FeeBreakdown } from "@/components/shared/FeeBreakdown";
import { requireBiometric } from "@/lib/biometric";
import { cacheSet, cacheGet } from "@/lib/offline-cache";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

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
  const [visibleBills, setVisibleBills] = useState<BillRow[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);

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

      {/* Outstanding hero */}
      <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 opacity-80">
            <p className="text-sm">Outstanding</p>
            {outstanding && <FeeBreakdown amount={outstanding.amount} />}
          </div>
          <p className="mt-1 text-4xl font-semibold tabular-nums">₹{(outstanding?.amount ?? 0).toLocaleString("en-IN")}</p>
          <p className="mt-1 text-xs opacity-80">{outstanding ? `Due ${outstanding.due}` : "No outstanding dues"}</p>
          <Button
            disabled={!outstanding}
            onClick={async () => {
              if (!outstanding) return;
              const ok = await requireBiometric("authorize this payment");
              if (ok) navigate({ to: "/app/dues" });
            }}
            className="mt-5 w-full h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold disabled:opacity-60"
          >
            <Fingerprint className="h-4 w-4 mr-2" />
            Pay now <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

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
    </div>
  );
}
