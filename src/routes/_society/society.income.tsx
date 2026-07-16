import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Coins,
  Loader2,
  AlertCircle,
  TrendingUp,
  Clock,
  XCircle,
  RotateCcw,
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
  Tags,
} from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listIncomeRecordsFn,
  getIncomeDashboardFn,
  listIncomeCategoriesFn,
} from "@/lib/non-member-income.functions";
import type {
  IncomeVerificationStatus,
  IncomeReconciliationStatus,
  IncomePaymentMethod,
  IncomePayerKind,
  IncomeSort,
} from "@/lib/non-member-income.server";

interface CategoryItem {
  id: string;
  key: string;
  display_name: string;
  description: string | null;
  category_group: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

export const Route = createFileRoute("/_society/society/income")({
  head: () => ({
    meta: [
      { title: "Income & Collections — SociyoHub" },
      {
        name: "description",
        content:
          "Track society income, external payers and offline payment verification.",
      },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <IncomePage />
    </FeatureGate>
  ),
});

const PAGE_SIZE = 25;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type Period = "this_month" | "last_month" | "last_90" | "custom";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodRange(
  p: Period,
  customFrom: string,
  customTo: string,
): { from: string | undefined; to: string | undefined } {
  const now = new Date();
  if (p === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: isoDate(start), to: todayISO() };
  }
  if (p === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  if (p === "last_90") return { from: todayISO(-90), to: todayISO() };
  // custom
  const isValidIso = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isValidIso(customFrom) || !isValidIso(customTo)) return { from: undefined, to: undefined };
  if (customFrom > customTo) return { from: undefined, to: undefined };
  return { from: customFrom, to: customTo };
}

const VERIF_OPTIONS: ReadonlyArray<{ value: "all" | IncomeVerificationStatus; label: string }> = [
  { value: "all", label: "All verification" },
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "reversed", label: "Reversed" },
];

const RECON_OPTIONS: ReadonlyArray<{ value: "all" | IncomeReconciliationStatus; label: string }> = [
  { value: "all", label: "All reconciliation" },
  { value: "unreconciled", label: "Unreconciled" },
  { value: "matched", label: "Matched" },
  { value: "partially_matched", label: "Partially matched" },
  { value: "needs_review", label: "Needs review" },
  { value: "reversed", label: "Reversed" },
];

const METHOD_OPTIONS: ReadonlyArray<{ value: "all" | IncomePaymentMethod; label: string }> = [
  { value: "all", label: "All methods" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "other_offline", label: "Other offline" },
];

const KIND_OPTIONS: ReadonlyArray<{ value: "all" | IncomePayerKind; label: string }> = [
  { value: "all", label: "All payers" },
  { value: "resident", label: "Resident" },
  { value: "non_member", label: "Non-member" },
  { value: "anonymous", label: "Anonymous" },
];

const SORT_OPTIONS: ReadonlyArray<{ value: IncomeSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount_desc", label: "Amount: high to low" },
  { value: "amount_asc", label: "Amount: low to high" },
];

function IncomePage() {
  const { societyId, loading } = useSocietyId();

  const [period, setPeriod] = useState<Period>("this_month");
  const [customFrom, setCustomFrom] = useState<string>(todayISO(-30));
  const [customTo, setCustomTo] = useState<string>(todayISO());
  const [verif, setVerif] = useState<"all" | IncomeVerificationStatus>("all");
  const [recon, setRecon] = useState<"all" | IncomeReconciliationStatus>("all");
  const [method, setMethod] = useState<"all" | IncomePaymentMethod>("all");
  const [kind, setKind] = useState<"all" | IncomePayerKind>("all");
  const [categoryId, setCategoryId] = useState<"all" | string>("all");
  const [sort, setSort] = useState<IncomeSort>("newest");
  const [page, setPage] = useState<number>(0);

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const dateRangeValid = period !== "custom" || (range.from !== undefined && range.to !== undefined);

  // Reset to first page when any filter changes.
  useEffect(() => {
    setPage(0);
  }, [period, customFrom, customTo, verif, recon, method, kind, categoryId, sort]);

  const getDashboard = useServerFn(getIncomeDashboardFn);
  const listRecords = useServerFn(listIncomeRecordsFn);
  const listCats = useServerFn(listIncomeCategoriesFn);

  const isForbidden = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : "";
    return msg.includes("forbidden");
  };

  const dashboardQ = useQuery({
    enabled: !!societyId && dateRangeValid,
    queryKey: ["society-income", "dashboard", societyId, period, range.from, range.to],
    retry: (n, e: unknown) => n < 1 && !isForbidden(e),
    queryFn: async () =>
      getDashboard({
        data: { societyId: societyId!, from_date: range.from, to_date: range.to },
      }),
  });

  const catsQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "categories", societyId],
    queryFn: async () => listCats({ data: { societyId: societyId! } }),
  });

  const listQ = useQuery({
    enabled: !!societyId && dateRangeValid,
    queryKey: [
      "society-income",
      "list",
      societyId,
      period,
      range.from,
      range.to,
      verif,
      recon,
      method,
      kind,
      categoryId,
      sort,
      page,
    ],
    retry: (n, e: unknown) => n < 1 && !isForbidden(e),
    queryFn: async () =>
      listRecords({
        data: {
          societyId: societyId!,
          from_date: range.from,
          to_date: range.to,
          verification_status: verif === "all" ? undefined : verif,
          reconciliation_status: recon === "all" ? undefined : recon,
          payment_method: method === "all" ? undefined : method,
          payer_kind: kind === "all" ? undefined : kind,
          category_id: categoryId === "all" ? undefined : categoryId,
          sort,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
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
  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? null;
  const totalPages =
    total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNext = total === null ? items.length === PAGE_SIZE : page + 1 < (totalPages ?? 1);

  const resetFilters = () => {
    setPeriod("this_month");
    setVerif("all");
    setRecon("all");
    setMethod("all");
    setKind("all");
    setCategoryId("all");
    setSort("newest");
    setPage(0);
  };

  return (
    <div className="px-4 py-6 max-w-6xl mx-auto space-y-4">
      <AccountsCenterTabs />
      <MobileHero
        icon={Coins}
        title="Income & Collections"
        subtitle="Track society income, external payers and offline payment verification."
      />

      <SectionCard title="Filters" description="Filters reset the record list to the first page.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[160px]">
            <Label className="text-xs">Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
                <SelectItem value="last_90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {period === "custom" && (
            <>
              <div className="min-w-[140px]">
                <Label className="text-xs" htmlFor="from-date">From</Label>
                <Input
                  id="from-date"
                  type="date"
                  className="min-h-[44px]"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="min-w-[140px]">
                <Label className="text-xs" htmlFor="to-date">To</Label>
                <Input
                  id="to-date"
                  type="date"
                  className="min-h-[44px]"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
              {!dateRangeValid && (
                <p className="w-full text-xs text-destructive">
                  Please enter a valid date range where "From" is on or before "To".
                </p>
              )}
            </>
          )}

          <div className="min-w-[160px]">
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {((catsQ.data?.items ?? []) as CategoryItem[]).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">Payer</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">Verification</Label>
            <Select value={verif} onValueChange={(v) => setVerif(v as typeof verif)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VERIF_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">Reconciliation</Label>
            <Select value={recon} onValueChange={(v) => setRecon(v as typeof recon)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">Sort</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as IncomeSort)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={resetFilters}
          >
            Reset
          </Button>
        </div>
      </SectionCard>

      {dashboardQ.isError ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> Income summary is temporarily unavailable.
          </CardContent>
        </Card>
      ) : dashboardQ.isLoading || !d ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading income summary…
          </CardContent>
        </Card>
      ) : (
        <>
          <StatPillRow>
            <StatPill icon={TrendingUp} label="Verified income" value={inr(d.verifiedTotal)} />
            <StatPill icon={Clock} label="Pending" value={String(d.pendingCount)} />
            <StatPill icon={AlertCircle} label="Unreconciled" value={String(d.unreconciled)} />
            <StatPill icon={AlertCircle} label="Needs review" value={String(d.needsReview)} />
            <StatPill icon={XCircle} label="Rejected" value={String(d.rejectedCount)} />
            <StatPill icon={RotateCcw} label="Reversed" value={String(d.reversedCount)} />
            <StatPill
              icon={Users}
              label="Active payers"
              value={
                d.activePayerCount.status === "available"
                  ? String(d.activePayerCount.value)
                  : "—"
              }
            />
          </StatPillRow>
          {d.activePayerCount.status === "error" && (
            <p className="text-xs text-destructive">
              Active payer count is temporarily unavailable.
            </p>
          )}
          {d.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Dashboard totals aggregated over the most recent {d.recordCount} records.
              Narrow the date range for authoritative totals.
            </p>
          )}
        </>
      )}

      {d && d.byCategory.length > 0 && (
        <SectionCard
          title="Verified income by category"
          description="Excludes pending, rejected and reversed records."
        >
          <div className="grid sm:grid-cols-2 gap-2">
            {d.byCategory.map((c) => (
              <div
                key={c.category_id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span>
                  {((catsQ.data?.items ?? []) as CategoryItem[]).find(
                    (x) => x.id === c.category_id,
                  )?.display_name ?? "—"}
                </span>
                <span className="font-medium tabular-nums">{inr(c.total)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {d && d.byMethod.length > 0 && (
        <SectionCard title="Verified income by payment method">
          <div className="grid sm:grid-cols-3 gap-2">
            {d.byMethod.map((m) => (
              <div
                key={m.method}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span className="capitalize">{m.method.replace(/_/g, " ")}</span>
                <span className="font-medium tabular-nums">{inr(m.total)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Records"
        description="Income records for the selected filters. Full reference numbers are masked."
      >
        {listQ.isError ? (
          <div className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Records are temporarily unavailable.
          </div>
        ) : listQ.isLoading ? (
          <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No records match the selected filters.
          </div>
        ) : (
          <div className="divide-y">
            {items.map((r) => {
              const payerLabel =
                r.payer_kind === "anonymous"
                  ? "Anonymous"
                  : r.payer_display_name ?? "—";
              return (
                <Link
                  key={r.id}
                  to="/society/income/$id"
                  params={{ id: r.id }}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40 rounded-md px-2 min-h-[44px]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {r.category_display_name ?? "Income"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.payment_date} · {r.payment_method.replace(/_/g, " ")} · {payerLabel}
                      {r.reference_suffix ? ` · ref ${r.reference_suffix}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tabular-nums font-semibold">{inr(r.amount)}</div>
                    <div className="flex flex-wrap justify-end gap-1 mt-1">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {r.verification_status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {r.reconciliation_status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hasNext={hasNext}
          shown={items.length}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      </SectionCard>

      <p className="text-xs text-muted-foreground">
        Verify, reject and reverse workflows will arrive in the next update.
      </p>
    </div>
  );
}

function Pagination(props: {
  page: number;
  pageSize: number;
  total: number | null;
  hasNext: boolean;
  shown: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { page, pageSize, total, hasNext, shown, onPrev, onNext } = props;
  const start = page * pageSize + (shown > 0 ? 1 : 0);
  const end = page * pageSize + shown;
  const label =
    total !== null
      ? `${start}–${end} of ${total}`
      : shown === 0
        ? `Page ${page + 1}`
        : `${start}–${end}`;
  const _icon: LucideIcon = ChevronLeft; // keep import used when disabled state
  void _icon;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 flex-wrap">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] min-w-[44px]"
          onClick={onPrev}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Previous</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] min-w-[44px]"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next page"
        >
          <span className="mr-1 hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
