import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building2,
  Wallet,
  AlertTriangle,
  Megaphone,
  ArrowUpRight,
  KeyRound,
  Copy,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SocioHub" },
      { name: "description", content: "Society admin overview." },
    ],
  }),
  component: SocietyDashboard,
});

const announcements = [
  { title: "Diwali decoration drive", date: "07 May 2026", category: "Events" },
  { title: "Lift maintenance — Block B", date: "06 May 2026", category: "Maintenance" },
  { title: "Society AGM rescheduled", date: "04 May 2026", category: "Notices" },
  { title: "New visitor entry SOP", date: "01 May 2026", category: "Security" },
];

const txns = [
  { flat: "A-101", resident: "Priya Sharma", amount: "₹4,500", status: "Paid", date: "07 May" },
  { flat: "B-204", resident: "Rohit Verma", amount: "₹4,500", status: "Paid", date: "06 May" },
  { flat: "C-302", resident: "Anita Iyer", amount: "₹4,500", status: "Pending", date: "05 May" },
  { flat: "A-405", resident: "Karan Mehta", amount: "₹4,500", status: "Failed", date: "04 May" },
  { flat: "B-101", resident: "Sneha Patil", amount: "₹4,500", status: "Paid", date: "03 May" },
  { flat: "D-208", resident: "Vikram Joshi", amount: "₹4,500", status: "Paid", date: "02 May" },
];

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Paid: "bg-success/10 text-success",
    Pending: "bg-warning/10 text-warning",
    Failed: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function SocietyDashboard() {
  const { societyId } = useSocietyId();
  const [society, setSociety] = useState<{ name: string; invite_code: string | null } | null>(null);

  useEffect(() => {
    if (!societyId) return;
    supabase
      .from("societies")
      .select("name, invite_code")
      .eq("id", societyId)
      .maybeSingle()
      .then(({ data }) => setSociety(data as any));
  }, [societyId]);

  function copyCode() {
    if (!society?.invite_code) return;
    navigator.clipboard.writeText(society.invite_code);
    toast.success("Invite code copied");
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">A snapshot of your society today.</p>
      </header>

      {society?.invite_code && (
        <Card className="rounded-2xl mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-5 flex flex-wrap items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 grid place-items-center">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Invite code for residents</p>
              <p className="text-2xl font-bold tracking-[0.3em] font-mono mt-0.5">
                {society.invite_code}
              </p>
            </div>
            <Button onClick={copyCode} variant="outline" className="rounded-xl">
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Registered Flats</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">428</p>
            <p className="mt-1 text-xs text-muted-foreground">Across 6 blocks</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected this month</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Wallet className="h-5 w-5 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">₹12,84,500</p>
            <p className="mt-1 text-xs text-success">+12% vs last month</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Defaulters</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-destructive/10 grid place-items-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl md:text-4xl font-semibold tabular-nums">37</p>
            <p className="mt-1 text-xs text-muted-foreground">Needs follow-up</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-primary" /> Recent Announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {announcements.map((a) => (
                <li key={a.title} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{a.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{a.date}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                      {a.category}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent Transactions</CardTitle>
            <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all <ArrowUpRight className="h-3 w-3" />
            </button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Flat</th>
                    <th className="px-2 py-2 font-medium">Resident</th>
                    <th className="px-2 py-2 font-medium">Amount</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {txns.map((t) => (
                    <tr key={t.flat + t.date}>
                      <td className="px-2 py-3 font-medium">{t.flat}</td>
                      <td className="px-2 py-3 text-muted-foreground">{t.resident}</td>
                      <td className="px-2 py-3 tabular-nums">{t.amount}</td>
                      <td className="px-2 py-3"><StatusPill status={t.status} /></td>
                      <td className="px-2 py-3 text-muted-foreground">{t.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
