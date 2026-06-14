import { createFileRoute, Link } from "@tanstack/react-router";
import { Wallet, ArrowRight, Check, Clock, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/dues")({
  head: () => ({ meta: [{ title: "Dues — SocioHub" }] }),
  component: DuesPage,
});

const CURRENT = {
  month: "December 2026",
  amount: 4250,
  dueDate: "15 Dec",
  breakdown: [
    { label: "Maintenance", amount: 3000 },
    { label: "Water", amount: 450 },
    { label: "Sinking fund", amount: 500 },
    { label: "Festival fund", amount: 300 },
  ],
};

const HISTORY = [
  { id: "1", month: "November 2026", amount: 4250, paid: true, date: "10 Nov" },
  { id: "2", month: "October 2026", amount: 4250, paid: true, date: "12 Oct" },
  { id: "3", month: "September 2026", amount: 4100, paid: true, date: "08 Sep" },
];

function DuesPage() {
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
            <span className="text-xs opacity-90">{CURRENT.month}</span>
            <Badge className="bg-white/20 text-white border-0 rounded-full text-[10px]">
              <Clock className="h-3 w-3 mr-1" />
              Due {CURRENT.dueDate}
            </Badge>
          </div>
          <div className="flex items-baseline gap-1">
            <IndianRupee className="h-6 w-6" />
            <span className="text-4xl font-bold tracking-tight">
              {CURRENT.amount.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="space-y-1.5 pt-1">
            {CURRENT.breakdown.map((b) => (
              <div key={b.label} className="flex justify-between text-xs opacity-90">
                <span>{b.label}</span>
                <span>₹{b.amount.toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
          <Button
            asChild
            size="lg"
            className="w-full bg-white text-primary hover:bg-white/90 rounded-xl font-semibold"
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
          {HISTORY.map((h) => (
            <Card key={h.id} className="rounded-xl">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-emerald-100 grid place-items-center">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{h.month}</p>
                  <p className="text-[11px] text-muted-foreground">Paid on {h.date}</p>
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
