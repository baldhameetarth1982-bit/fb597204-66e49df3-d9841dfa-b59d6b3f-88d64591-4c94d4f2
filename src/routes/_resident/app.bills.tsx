import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Receipt, Download, Clock, CheckCircle2, ArrowRight, Fingerprint } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FeeBreakdown } from "@/components/shared/FeeBreakdown";
import { requireBiometric } from "@/lib/biometric";
import { cacheSet, cacheGet } from "@/lib/offline-cache";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_resident/app/bills")({
  head: () => ({ meta: [{ title: "Bills — SocioHub" }] }),
  component: BillsScreen,
});

const bills = [
  { id: "1", title: "May 2026 Maintenance", amount: 4500, due: "10 May 2026", status: "due" },
  { id: "2", title: "April 2026 Maintenance", amount: 4500, due: "10 Apr 2026", status: "paid" },
  { id: "3", title: "March 2026 Maintenance", amount: 4500, due: "10 Mar 2026", status: "paid" },
  { id: "4", title: "Annual Sinking Fund", amount: 6000, due: "01 Apr 2026", status: "paid" },
];

function BillsScreen() {
  const navigate = useNavigate();
  const [visibleBills, setVisibleBills] = useState(bills);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => {
      const isNowOnline = navigator.onLine;
      setOnline(isNowOnline);
      if (isNowOnline) {
        cacheSet("bills", bills);
        setVisibleBills(bills);
      } else {
        setVisibleBills(cacheGet<typeof bills>("bills") ?? bills);
      }
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
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
            <FeeBreakdown amount={4500} />
          </div>
          <p className="mt-1 text-4xl font-semibold tabular-nums">₹4,500</p>
          <p className="mt-1 text-xs opacity-80">Due 10 May 2026</p>
          <Button
            onClick={async () => {
              const ok = await requireBiometric("authorize this payment");
              if (ok) navigate({ to: "/app/dues" });
            }}
            className="mt-5 w-full h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold"
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
          {visibleBills.map((b) => {
            const paid = b.status === "paid";
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
