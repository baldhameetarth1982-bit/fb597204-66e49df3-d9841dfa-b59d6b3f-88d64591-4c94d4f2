import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell, ArrowRight, Receipt, ShieldCheck, ShieldAlert, Fingerprint, Inbox,
  Megaphone, LifeBuoy, FileText, Phone, Wallet, Building2, Bot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { AdBanner } from "@/components/shared/AdBanner";
import { requireBiometric } from "@/lib/biometric";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_resident/app/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — SocioHub" },
      { name: "description", content: "Your maintenance dues and society updates." },
    ],
  }),
  component: ResidentDashboard,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

interface DueBill {
  id: string;
  amount: number;
  due_date: string | null;
  period_label: string | null;
}
interface Notice {
  id: string;
  excerpt: string;
  created_at: string;
}

function excerpt(body: string, n = 80) {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ResidentDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  const [dueBill, setDueBill] = useState<DueBill | null>(null);
  const [paidYearTotal, setPaidYearTotal] = useState(0);
  const [visitorsToday, setVisitorsToday] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    const societyId = profile?.society_id;
    const userId = profile?.id;
    if (!societyId || !userId) return;
    let cancelled = false;

    (async () => {
      const yearStart = new Date();
      yearStart.setMonth(0, 1);
      yearStart.setHours(0, 0, 0, 0);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);

      // Resolve resident's flats
      const { data: flatRows } = await supabase
        .from("flat_residents")
        .select("flat_id")
        .eq("user_id", userId);
      const flatIds = (flatRows ?? []).map((r: any) => r.flat_id).filter(Boolean);

      const billsQ = flatIds.length
        ? supabase
            .from("bills")
            .select("id, amount, due_date, period_label, status")
            .eq("society_id", societyId)
            .in("flat_id", flatIds)
            .in("status", ["unpaid", "overdue"])
            .order("due_date", { ascending: true })
            .limit(1)
        : Promise.resolve({ data: [] as any[] });

      const [bills, payments, visitors, posts] = await Promise.all([
        billsQ as any,
        supabase
          .from("payments")
          .select("amount, paid_at, status, user_id")
          .eq("society_id", societyId)
          .eq("user_id", userId)
          .eq("status", "success")
          .gte("paid_at", yearStart.toISOString()),
        supabase
          .from("visitors")
          .select("id", { count: "exact", head: true })
          .eq("society_id", societyId)
          .gte("entry_at", dayStart.toISOString()),
        supabase
          .from("posts")
          .select("id, body, created_at")
          .eq("society_id", societyId)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      if (cancelled) return;
      const bill = bills.data?.[0];
      setDueBill(
        bill
          ? {
              id: bill.id,
              amount: Number(bill.amount),
              due_date: bill.due_date,
              period_label: bill.period_label ?? null,
            }
          : null,
      );
      setPaidYearTotal((payments.data ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0));
      setVisitorsToday(visitors.count ?? 0);
      setNotices(
        (posts.data ?? []).map((p: any) => ({
          id: p.id,
          excerpt: excerpt(p.body ?? ""),
          created_at: p.created_at,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.society_id, profile?.id]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">
            Hi {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground truncate">
            Welcome back
          </p>
        </div>
        <Link
          to="/app/notifications"
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-background hover:bg-accent"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </Link>
      </header>

      <QuickActions />


      <Card className="rounded-2xl bg-primary text-primary-foreground border-0">
        <CardContent className="p-6 md:p-8">
          <p className="text-sm opacity-80">Amount due</p>
          <p className="mt-1 text-4xl md:text-5xl font-semibold tabular-nums">
            {dueBill ? INR.format(dueBill.amount) : INR.format(0)}
          </p>
          <p className="mt-1 text-sm opacity-80">
            {dueBill
              ? `${dueBill.period_label ?? "Maintenance"} · due ${dueBill.due_date ? new Date(dueBill.due_date).toLocaleDateString() : "soon"}`
              : "You're all caught up. No outstanding dues."}
          </p>
          <Button
            size="lg"
            disabled={!dueBill}
            className="mt-6 w-full md:w-auto h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold disabled:opacity-60"
            onClick={async () => {
              if (!dueBill) return;
              const ok = await requireBiometric("authorize this payment");
              if (ok) navigate({ to: "/app/dues" });
            }}
          >
            <Fingerprint className="h-4 w-4 mr-2" /> Pay now <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      <section className="grid grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Receipt className="h-5 w-5 text-success" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Paid this year</p>
            <p className="text-xl font-semibold tabular-nums">{INR.format(paidYearTotal)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Visitors today</p>
            <p className="text-xl font-semibold tabular-nums">{visitorsToday}</p>
          </CardContent>
        </Card>
      </section>

      <Button
        asChild
        variant="outline"
        className="w-full h-12 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Link to="/app/emergency">
          <ShieldAlert className="h-4 w-4 mr-2" /> Emergency contacts (works offline)
        </Link>
      </Button>

      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Recent notices</h2>
          </div>
          {notices.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Inbox className="h-5 w-5 mx-auto mb-1.5 opacity-60" />
              No notices yet
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notices.map((n) => (
                <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-medium line-clamp-2">{n.excerpt}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(n.created_at).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" asChild className="mt-2 rounded-lg">
            <Link to="/app/notices">View all <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
        </CardContent>
      </Card>

      <AdBanner />
    </div>
  );
}

const QUICK_ACTIONS: Array<{ to: string; label: string; icon: any; tone: string }> = [
  { to: "/app/dues", label: "Pay", icon: Wallet, tone: "bg-emerald-500/10 text-emerald-600" },
  { to: "/app/bills", label: "Bills", icon: Receipt, tone: "bg-primary/10 text-primary" },
  { to: "/app/visitors", label: "Visitors", icon: ShieldCheck, tone: "bg-sky-500/10 text-sky-600" },
  { to: "/app/helpdesk", label: "Complaints", icon: LifeBuoy, tone: "bg-rose-500/10 text-rose-600" },
  { to: "/app/comm", label: "Notices", icon: Megaphone, tone: "bg-amber-500/10 text-amber-600" },
  { to: "/app/bylaws", label: "Documents", icon: FileText, tone: "bg-violet-500/10 text-violet-600" },
  { to: "/support", label: "Ask AI", icon: Bot, tone: "bg-indigo-500/10 text-indigo-600" },
  { to: "/app/emergency", label: "SOS", icon: ShieldAlert, tone: "bg-destructive/10 text-destructive" },
];

function QuickActions() {
  return (
    <section aria-label="Quick actions">
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.label}
              to={a.to}
              className="flex flex-col items-center gap-1.5 rounded-2xl border bg-card p-3 hover:bg-accent/40 transition-colors"
            >
              <span className={`h-10 w-10 rounded-xl grid place-items-center ${a.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-medium text-center leading-tight">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

