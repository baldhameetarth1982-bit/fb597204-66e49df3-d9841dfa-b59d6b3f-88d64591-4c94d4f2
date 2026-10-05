import { useTranslation } from "react-i18next";
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
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";

import { incomeKeys } from "@/lib/income-query-keys";
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
  getSocietyIncomeReportFn,
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

export const Route = createFileRoute("/_society/society/income/")({
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
    <IncomeAccessBoundary>
      {(societyId) => <IncomePage societyId={societyId} />}
    </IncomeAccessBoundary>
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
  { value: "all", label: "inc.f.allVerif" },
  { value: "pending", label: "inc.st.pending" },
  { value: "verified", label: "inc.st.verified" },
  { value: "rejected", label: "inc.st.rejected" },
  { value: "reversed", label: "inc.st.reversed" },
];

const RECON_OPTIONS: ReadonlyArray<{ value: "all" | IncomeReconciliationStatus; label: string }> = [
  { value: "all", label: "inc.f.allRecon" },
  { value: "unreconciled", label: "inc.rc.unreconciled" },
  { value: "matched", label: "inc.rc.matched" },
  { value: "partially_matched", label: "inc.rc.partial" },
  { value: "needs_review", label: "inc.rc.review" },
  { value: "reversed", label: "inc.st.reversed" },
];

const METHOD_OPTIONS: ReadonlyArray<{ value: "all" | IncomePaymentMethod; label: string }> = [
  { value: "all", label: "inc.f.allMethods" },
  { value: "cash", label: "inc.m.cash" },
  { value: "bank_transfer", label: "inc.m.bank" },
  { value: "other_offline", label: "inc.m.other" },
];

const KIND_OPTIONS: ReadonlyArray<{ value: "all" | IncomePayerKind; label: string }> = [
  { value: "all", label: "inc.f.allPayers" },
  { value: "resident", label: "inc.k.resident" },
  { value: "non_member", label: "inc.k.nonMember" },
  { value: "anonymous", label: "inc.k.anon" },
];

const SORT_OPTIONS: ReadonlyArray<{ value: IncomeSort; label: string }> = [
  { value: "newest", label: "inc.s.newest" },
  { value: "oldest", label: "inc.s.oldest" },
  { value: "amount_desc", label: "inc.s.amtDesc" },
  { value: "amount_asc", label: "inc.s.amtAsc" },
];

function IncomePage({ societyId }: { societyId: string }) {
  const { t } = useTranslation();


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

  const getReport = useServerFn(getSocietyIncomeReportFn);
  const listRecords = useServerFn(listIncomeRecordsFn);
  const listCats = useServerFn(listIncomeCategoriesFn);

  const isForbidden = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : "";
    return msg.includes("forbidden");
  };

  const listFilters = {
    from_date: range.from,
    to_date: range.to,
    verification_status: verif,
    reconciliation_status: recon,
    payment_method: method,
    category_id: categoryId,
    sort,
  };

  const reportQ = useQuery({
    enabled: dateRangeValid && !!range.from && !!range.to,
    queryKey: incomeKeys.dashboard(societyId, {
      from_date: range.from,
      to_date: range.to,
      verification_status: verif === "all" ? undefined : verif,
      reconciliation_status: recon === "all" ? undefined : recon,
      payment_method: method === "all" ? undefined : method,
      category_id: categoryId === "all" ? undefined : categoryId,
    }),
    retry: (n, e: unknown) => n < 1 && !isForbidden(e),
    queryFn: async () =>
      getReport({
        data: {
          societyId,
          from_date: range.from!,
          to_date: range.to!,
          verification_status: verif === "all" ? undefined : verif,
          reconciliation_status: recon === "all" ? undefined : recon,
          payment_method: method === "all" ? undefined : method,
          category_id: categoryId === "all" ? undefined : categoryId,
          payer_kind: kind === "all" ? undefined : kind,
        },
      }),
  });


  const catsQ = useQuery({
    queryKey: incomeKeys.activeCategories(societyId),
    queryFn: async () => listCats({ data: { societyId } }),
  });

  const listQ = useQuery({
    enabled: dateRangeValid,
    queryKey: incomeKeys.records(societyId, listFilters, page),

    retry: (n, e: unknown) => n < 1 && !isForbidden(e),
    queryFn: async () =>
      listRecords({
        data: {
          societyId,
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



  const reportResp = reportQ.data;
  const report =
    reportResp && reportResp.status === "ok" ? reportResp : null;

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? null;
  const totalPages =
    total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNext = total === null ? items.length === PAGE_SIZE : page + 1 < (totalPages ?? 1);

  const [exporting, setExporting] = useState(false);
  const exportRecords = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const all: typeof items = [];
      for (let offset = 0; offset < 10000; offset += 200) {
        const res = await listRecords({ data: {
          societyId, from_date: range.from, to_date: range.to,
          verification_status: verif === "all" ? undefined : verif,
          reconciliation_status: recon === "all" ? undefined : recon,
          payment_method: method === "all" ? undefined : method,
          payer_kind: kind === "all" ? undefined : kind,
          category_id: categoryId === "all" ? undefined : categoryId,
          sort, limit: 200, offset,
        } });
        all.push(...res.items);
        if (res.items.length < 200) break;
      }
      if (!all.length) { toast.info(t("inc.noMatchToast")); return; }
      writeSafeWorkbook(all.map((r) => ({
        Date: r.payment_date,
        Category: r.category_display_name ?? "",
        Payer: r.payer_kind === "anonymous" ? "Anonymous" : r.payer_display_name ?? "",
        "Payer type": r.payer_kind.replace(/_/g, " "),
        "Amount (Rs.)": Number(r.amount),
        Method: r.payment_method.replace(/_/g, " "),
        Verification: r.verification_status.replace(/_/g, " "),
        Reconciliation: r.reconciliation_status.replace(/_/g, " "),
        "Reference (last digits)": r.reference_suffix ?? "",
      })), "Income", `income-${range.from ?? "all"}-to-${range.to ?? "all"}.xlsx`);
      toast.success(t("inc.downloaded", { count: all.length }));
    } catch {
      toast.error(t("inc.dlFail"));
    } finally { setExporting(false); }
  };

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
        title={t("inc.title")}
        subtitle="Track society income, external payers and offline payment verification."
      />

      <div className="flex flex-wrap gap-2">
        <Button asChild className="min-h-[44px]">
          <Link to="/society/income/new">
            <Plus className="h-4 w-4 mr-1" /> {t("inc.record")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link to="/society/income/categories">
            <Tags className="h-4 w-4 mr-1" /> {t("inc.categories")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link to="/society/income/payers">
            <Users className="h-4 w-4 mr-1" /> {t("inc.payers")}
          </Link>
        </Button>
        <Button variant="outline" className="min-h-[44px]" disabled={exporting || !dateRangeValid} onClick={() => void exportRecords()}>
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} Download list
        </Button>
      </div>

      <SectionCard title={t("inc.filters")} description={t("inc.filtersHint")}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.period")}</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger aria-label="Period" className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">{t("ff.thisMonth")}</SelectItem>
                <SelectItem value="last_month">{t("ff.lastMonth")}</SelectItem>
                <SelectItem value="last_90">{t("inc.last90")}</SelectItem>
                <SelectItem value="custom">{t("inc.custom")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {period === "custom" && (
            <>
              <div className="min-w-[140px]">
                <Label className="text-xs" htmlFor="from-date">{t("common.from")}</Label>
                <Input
                  id="from-date"
                  type="date"
                  className="min-h-[44px]"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="min-w-[140px]">
                <Label className="text-xs" htmlFor="to-date">{t("common.to")}</Label>
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
                  {t("inc.rangeInvalid")}
                </p>
              )}
            </>
          )}

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("common.category")}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Category" className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ff.allCategories")}</SelectItem>
                {((catsQ.data?.items ?? []) as CategoryItem[]).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.payer")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger aria-label="Payer" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.method")}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger aria-label="Method" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.verification")}</Label>
            <Select value={verif} onValueChange={(v) => setVerif(v as typeof verif)}>
              <SelectTrigger aria-label="Verification" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VERIF_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.reconciliation")}</Label>
            <Select value={recon} onValueChange={(v) => setRecon(v as typeof recon)}>
              <SelectTrigger aria-label="Reconciliation" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <Label className="text-xs">{t("inc.sort")}</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as IncomeSort)}>
              <SelectTrigger aria-label="Sort" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={resetFilters}
          >
            {t("inc.reset")}
          </Button>
        </div>
      </SectionCard>

      {reportQ.isError || (reportResp && reportResp.status !== "ok") ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {t("inc.sumFail")}
          </CardContent>
        </Card>
      ) : reportQ.isLoading || !report ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("inc.sumLoading")}
          </CardContent>
        </Card>
      ) : (
        <>
          <StatPillRow>
            <StatPill icon={TrendingUp} label={t("inc.verifiedIncome")} value={inr(report.summary.verified_amount)} />
            <StatPill icon={Clock} label={t("inc.st.pending")} value={String(report.summary.pending_count)} />
            <StatPill icon={AlertCircle} label={t("inc.unrecVerified")} value={inr(report.summary.unreconciled_amount)} />
            <StatPill icon={TrendingUp} label={t("inc.rc.reconciled")} value={inr(report.summary.reconciled_amount)} />
            <StatPill icon={XCircle} label={t("inc.st.rejected")} value={String(report.summary.rejected_count)} />
            <StatPill icon={RotateCcw} label={t("inc.st.reversed")} value={String(report.summary.reversed_count)} />
            <StatPill icon={Users} label={t("inc.records")} value={String(report.summary.record_count)} />
          </StatPillRow>
          <p className="text-[11px] text-muted-foreground">
            Totals aggregated in the database for {report.from_date} → {report.to_date}
            {" "}(bucket: {report.trend_bucket}).
          </p>
        </>
      )}

      {report && report.by_category.length > 0 && (
        <SectionCard
          title={t("inc.byCat")}
          description={t("inc.excludes")}
        >
          <div className="grid sm:grid-cols-2 gap-2">
            {report.by_category.map((c) => (
              <div
                key={c.category_id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span>{c.display_name ?? "—"}</span>
                <span className="font-medium tabular-nums">{inr(c.amount)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {report && report.by_method.length > 0 && (
        <SectionCard title={t("inc.byMethod")}>
          <div className="grid sm:grid-cols-3 gap-2">
            {report.by_method.map((m) => (
              <div
                key={m.payment_method}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span className="capitalize">{m.payment_method.replace(/_/g, " ")}</span>
                <span className="font-medium tabular-nums">{inr(m.amount)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {report && report.trend.length > 0 && (
        <SectionCard
          title={t("inc.trend")}
          description={`Grouped by ${report.trend_bucket}.`}
        >
          <ul className="grid sm:grid-cols-3 gap-2 text-sm">
            {report.trend.map((t) => (
              <li
                key={t.bucket}
                className="flex items-center justify-between rounded-md border p-2"
              >
                <span className="tabular-nums">{t.bucket}</span>
                <span className="font-medium tabular-nums">{inr(t.amount)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}



      <SectionCard
        title={t("inc.records")}
        description={t("inc.tableDesc")}
      >
        {listQ.isError ? (
          <div className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {t("inc.recFail")}
          </div>
        ) : listQ.isLoading ? (
          <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("inc.recLoading")}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {t("inc.noMatch")}
          </div>
        ) : (
          <div className="divide-y">
            {items.map((r) => {
              const payerLabel =
                r.payer_kind === "anonymous"
                  ? t("inc.k.anon")
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
  const { t } = useTranslation();
  const start = page * pageSize + (shown > 0 ? 1 : 0);
  const end = page * pageSize + shown;
  const label =
    total !== null
      ? t("inc.rangeOf", { start, end, total })
      : shown === 0
        ? t("inc.page", { page: page + 1 })
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
          aria-label={t("inc.prevPage")}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">{t("inc.prev")}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] min-w-[44px]"
          onClick={onNext}
          disabled={!hasNext}
          aria-label={t("inc.nextPage")}
        >
          <span className="mr-1 hidden sm:inline">{t("inc.next")}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
