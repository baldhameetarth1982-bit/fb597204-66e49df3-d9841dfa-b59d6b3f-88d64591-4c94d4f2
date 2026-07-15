import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, AlertCircle, TrendingUp, Clock, XCircle, RotateCcw, Users } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listIncomeRecordsFn,
  getIncomeDashboardFn,
  listIncomeCategoriesFn,
} from "@/lib/non-member-income.functions";

export const Route = createFileRoute("/_society/society/income")({
  head: () => ({
    meta: [
      { title: "Income & Collections — SociyoHub" },
      { name: "description", content: "Track society income, external payers and offline payment verification." },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <IncomePage />
    </FeatureGate>
  ),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type Period = "this_month" | "last_month" | "last_90";

function periodRange(p: Period) {
  const now = new Date();
  if (p === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString().slice(0, 10), to: todayISO() };
  }
  if (p === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  return { from: todayISO(-90), to: todayISO() };
}

function IncomePage() {
  const { societyId, loading } = useSocietyId();
  const [period, setPeriod] = useState<Period>("this_month");
  const [verif, setVerif] = useState<string>("all");
  const [method, setMethod] = useState<string>("all");
  const range = useMemo(() => periodRange(period), [period]);

  const getDashboard = useServerFn(getIncomeDashboardFn);
  const listRecords = useServerFn(listIncomeRecordsFn);
  const listCats = useServerFn(listIncomeCategoriesFn);

  const dashboardQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "dashboard", societyId, period],
    retry: (n, e: any) => n < 1 && !String(e?.message ?? "").includes("forbidden"),
    queryFn: async () => getDashboard({ data: { societyId: societyId!, from_date: range.from, to_date: range.to } }),
  });

  const catsQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "categories", societyId],
    queryFn: async () => listCats({ data: { societyId: societyId! } }),
  });

  const listQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "list", societyId, period, verif, method],
    retry: (n, e: any) => n < 1 && !String(e?.message ?? "").includes("forbidden"),
    queryFn: async () =>
      listRecords({
        data: {
          societyId: societyId!,
          from_date: range.from,
          to_date: range.to,
          verification_status: verif === "all" ? undefined : (verif as any),
          payment_method: method === "all" ? undefined : (method as any),
          sort: "newest",
          limit: 50,
        },
      }),
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const d = dashboardQ.data;
  const catMap = new Map<string, string>(
    (catsQ.data?.items ?? []).map((c: any) => [c.id, c.display_name]),
  );

  return (
    <div className="px-4 py-6 max-w-6xl mx-auto space-y-4">
      <AccountsCenterTabs />
      <MobileHero
        icon={Coins}
        title="Income & Collections"
        subtitle="Track society income, external payers and offline payment verification."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="last_90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={verif} onValueChange={setVerif}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verification</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="reversed">Reversed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            <SelectItem value="other_offline">Other offline</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {dashboardQ.isError ? (
        <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Income summary is temporarily unavailable.
        </CardContent></Card>
      ) : dashboardQ.isLoading || !d ? (
        <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading income summary…
        </CardContent></Card>
      ) : (
        <StatPillRow>
          <StatPill icon={TrendingUp} label="Verified income" value={inr(d.verifiedTotal)} />
          <StatPill icon={Clock} label="Pending" value={String(d.pendingCount)} />
          <StatPill icon={AlertCircle} label="Unreconciled" value={String(d.unreconciled)} />
          <StatPill icon={AlertCircle} label="Needs review" value={String(d.needsReview)} />
          <StatPill icon={XCircle} label="Rejected" value={String(d.rejectedCount)} />
          <StatPill icon={RotateCcw} label="Reversed" value={String(d.reversedCount)} />
          <StatPill icon={Users} label="Active payers" value={String(d.activePayerCount)} />
        </StatPillRow>
      )}

      {d && d.byCategory.length > 0 && (
        <SectionCard title="Verified income by category" description="Excludes pending, rejected and reversed records.">
          <div className="grid sm:grid-cols-2 gap-2">
            {d.byCategory.map((c: any) => (
              <div key={c.category_id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>{catMap.get(c.category_id) ?? "—"}</span>
                <span className="font-medium tabular-nums">{inr(c.total)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {d && d.byMethod.length > 0 && (
        <SectionCard title="Verified income by payment method">
          <div className="grid sm:grid-cols-3 gap-2">
            {d.byMethod.map((m: any) => (
              <div key={m.method} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span className="capitalize">{String(m.method).replace(/_/g, " ")}</span>
                <span className="font-medium tabular-nums">{inr(m.total)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Recent records" description="Income records for the selected filters. Full reference numbers are masked.">
        {listQ.isError ? (
          <div className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Records are temporarily unavailable.
          </div>
        ) : listQ.isLoading ? (
          <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
          </div>
        ) : (listQ.data?.items ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            Income records will appear here after the first entry is added.
          </div>
        ) : (
          <div className="divide-y">
            {(listQ.data!.items as any[]).map((r) => (
              <Link
                key={r.id}
                to="/society/income/$id"
                params={{ id: r.id }}
                className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40 rounded-md px-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{catMap.get(r.category_id) ?? "Income"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.payment_date} · {String(r.payment_method).replace(/_/g, " ")}
                    {r.reference_suffix ? ` · ref ${r.reference_suffix}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums font-semibold">{inr(Number(r.amount))}</div>
                  <div className="flex justify-end gap-1 mt-1">
                    <Badge variant="outline" className="text-[10px] capitalize">{r.verification_status}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{String(r.reconciliation_status).replace(/_/g, " ")}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {listQ.data && listQ.data.total != null && listQ.data.total > (listQ.data.items?.length ?? 0) && (
          <div className="p-2 text-xs text-muted-foreground">
            Showing {listQ.data.items.length} of {listQ.data.total}. More records available.
          </div>
        )}
      </SectionCard>

      <p className="text-xs text-muted-foreground">
        Verify, reject and reverse workflows will arrive in the next update.
      </p>
    </div>
  );
}
