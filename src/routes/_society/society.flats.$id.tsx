import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Home,
  IndianRupee,
  Loader2,
  FileText,
  ArrowRight,
  History,
  MapPin,
  ListChecks,
  Car,
  Users,
  ShieldCheck,
  Wallet,
  AlertTriangle,
  Info,
  Lock,
  Sparkles,
} from "lucide-react";
import { PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getFlat360 } from "@/lib/flat360.functions";
import { getFlatNoDuesActivity } from "@/lib/no-dues.functions";
import { generateFlat360AISummaryFn } from "@/lib/flat360-ai.functions";
import type {
  Flat360Snapshot,
  SectionState,
  SafeNoDuesSection,
  AdvancedFinancialSection,
  OccupancyHistoryItem,
  VehicleItem,
  FamilyMember,
} from "@/lib/flat360-types";
import type { UnitSummary } from "@/lib/unit-summary";
import { AISummarySlot, type AISummaryUiState } from "@/components/flat360/AISummarySlot";
import { UpgradePrompt } from "@/components/subscription/UpgradePrompt";
import { isAIAllowedRoute } from "@/lib/flat360-types";
import { FlatLifecyclePanel } from "@/components/tenancy/FlatLifecyclePanel";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/flats/$id")({
  head: () => ({ meta: [{ title: "Flat 360 — SociyoHub" }] }),
  component: FlatDetailPage,
});

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const fmtINR = (n: number) => INR.format(Math.round(Number.isFinite(n) ? n : 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN") : "—";

function safeErrMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/* ------------------------------------------------------------------ */
/* Generic section-state renderer                                      */
/* ------------------------------------------------------------------ */

function SectionEmpty({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground py-2">{message}</p>;
}
function SectionUnsupported({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <Info className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
function SectionErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-amber-600 py-2" role="alert">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function renderSectionState<T>(
  state: SectionState<T>,
  render: (data: T) => React.ReactElement,
  opts: { emptyMessage?: string; unsupportedMessage?: string } = {},
): React.ReactElement | null {
  switch (state.status) {
    case "available":
      return render(state.data);
    case "empty":
      return <SectionEmpty message={opts.emptyMessage ?? tu("op.nothing_to_show_yet")} />;
    case "unsupported":
      return <SectionUnsupported message={opts.unsupportedMessage ?? state.message} />;
    case "error":
      return <SectionErrorRow message={state.message ?? tu("op.could_not_load_section")} />;
    case "locked":
      return null; // Basic sees the single global upgrade card
  }
}

/* ------------------------------------------------------------------ */
/* Section cards                                                       */
/* ------------------------------------------------------------------ */

function CardShell({
  title,
  icon: Icon,
  action,
  proBadge,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  proBadge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Icon className="h-4 w-4" aria-hidden="true" /> {title}
            {proBadge && (
              <Badge variant="outline" className="rounded-full text-[10px] ml-1">
                {tu("op.pro")}
              </Badge>
            )}
          </h3>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function IdentityHeader({ snapshot }: { snapshot: Flat360Snapshot }) {
  const { identity, occupancy } = snapshot;
  const isVacant = occupancy.kind === "vacant";
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-primary/10 grid place-items-center">
              <Home className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-lg font-bold leading-tight sm:text-xl">{identity.unit_label}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {identity.society_name ?? tu("nav.society")}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "rounded-full shrink-0 border-0",
              isVacant
                ? "bg-muted text-muted-foreground"
                : "bg-success-container text-success-container-foreground",
            )}
          >
            {isVacant
              ? tu("op.vacant")
              : occupancy.kind === "tenant_occupied"
                ? tu("op.tenant")
                : occupancy.kind === "owner_occupied"
                  ? tu("op.owner")
                  : occupancy.kind === "multi_resident"
                    ? `${occupancy.active_count} residents`
                    : "Occupied"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function OccupancySection({ snapshot }: { snapshot: Flat360Snapshot }) {
  const { occupancy, family } = snapshot;
  const primary =
    occupancy.residents.find((r) => r.is_primary && r.is_active) ??
    occupancy.residents.find((r) => r.is_active);
  return (
    <CardShell title={tu("op.current_residents")} icon={Users}>
      {occupancy.active_count === 0 ? (
        <SectionEmpty message={tu("op.no_active_residents")} />
      ) : (
        <ul className="divide-y divide-border/60">
          {occupancy.residents
            .filter((r) => r.is_active)
            .map((r, i) => (
              <li key={i} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {r.display_name ?? tu("inc.k.resident")}
                    {r.is_primary && (
                      <Badge variant="secondary" className="rounded-full text-[10px] ml-2">
                        {tu("op.primary")}
                      </Badge>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.relationship ?? "—"}
                    {r.moved_in_at && ` · Since ${fmtDate(r.moved_in_at)}`}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      )}
      {primary && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground mb-2">{tu("prof.family")}</div>
          {renderSectionState<FamilyMember[]>(
            family,
            (members) =>
              members.length === 0 ? (
                <SectionEmpty message={tu("op.no_family_members_recorded")} />
              ) : (
                <ul className="text-xs text-muted-foreground space-y-1">
                  {members.slice(0, 8).map((m) => (
                    <li key={m.id}>
                      <span className="font-medium text-foreground">{m.name}</span>
                      {m.relationship ? ` · ${m.relationship}` : ""}
                    </li>
                  ))}
                </ul>
              ),
            { emptyMessage: "No family members recorded." },
          )}
        </div>
      )}
    </CardShell>
  );
}

function BasicFinancialSection({ snapshot }: { snapshot: Flat360Snapshot }) {
  const availability = snapshot.financialAvailability;
  const b = snapshot.basicFinancial;
  return (
    <CardShell
      title={tu("op.financial_overview")}
      icon={IndianRupee}
      action={
        <Button asChild size="sm" variant="ghost" className="rounded-xl h-9 min-h-[36px]">
          <Link to="/society/billing">{tu("op.all_bills")}</Link>
        </Button>
      }
    >
      {availability.status !== "available" ? (
        availability.status === "error" ? (
          <SectionErrorRow message={tu("op.financial_information_could_not_be")} />
        ) : (
          <SectionUnsupported message={tu("op.financial_calculation_is_not_available")} />
        )
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {tu("sd.m.outstanding")}
              </p>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  b.current_outstanding > 0 ? "text-rose-600" : "text-emerald-600",
                )}
              >
                {fmtINR(b.current_outstanding)}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {b.overdue_count > 0 && (
                <p className="text-rose-600">
                  {b.overdue_count} {tu("op.overdue_bill")}{b.overdue_count === 1 ? "" : "s"}
                </p>
              )}
              {b.unpaid_count > 0 && (
                <p>
                  {b.unpaid_count} {tu("op.unpaid_bill")}{b.unpaid_count === 1 ? "" : "s"}
                </p>
              )}
              {b.current_outstanding === 0 &&
                b.overdue_count === 0 &&
                b.unpaid_count === 0 && <p className="text-emerald-600">{tu("op.no_outstanding_dues_2")}</p>}
            </div>
          </div>
          {b.latest_bill && (
            <div className="mt-2 pt-2 border-t border-border/40 text-xs text-muted-foreground">
              {tu("op.latest_bill")}{" "}
              <span className="font-medium text-foreground">
                {b.latest_bill.bill_number ?? b.latest_bill.period_label ?? tu("billingTabs.bill")}
              </span>{" "}
              · {fmtINR(b.latest_bill.amount)} · Due {fmtDate(b.latest_bill.due_date)}
            </div>
          )}
          {b.recent_successful_payments.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/40">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {tu("op.recent_payments")}
              </p>
              <ul className="space-y-1">
                {b.recent_successful_payments.slice(0, 3).map((p) => (
                  <li
                    key={p.id}
                    className="text-xs flex items-center justify-between gap-2"
                  >
                    <span className="text-muted-foreground truncate">
                      {p.method_label} · {fmtDate(p.paid_at)}
                    </span>
                    <span className="tabular-nums font-medium">{fmtINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

function AdvancedFinanceSection({
  state,
}: {
  state: SectionState<AdvancedFinancialSection>;
}) {
  return (
    <CardShell title={tu("op.advanced_finance")} icon={Wallet} proBadge>
      {renderSectionState<AdvancedFinancialSection>(
        state,
        (d) => (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <StatCell label={tu("sd.m.outstanding")} value={fmtINR(d.total_outstanding)} />
              <StatCell label={tu("op.pending_payments")} value={fmtINR(d.pending_payment_total)} />
              <StatCell label={tu("bills.overdue")} value={String(d.overdue_count)} />
              <StatCell label={tu("op.unpaid")} value={String(d.unpaid_count)} />
              <StatCell label={tu("op.partial")} value={String(d.partial_count)} />
              <StatCell
                label={tu("op.verify_pending")}
                value={String(d.pending_verification_count)}
              />
            </div>
            {d.inconsistency_count > 0 && (
              <div
                className="flex items-center gap-2 text-xs text-amber-600 rounded-lg bg-amber-500/10 px-3 py-2"
                role="alert"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {d.inconsistency_count} {tu("op.inconsistency_flagged_for_review")}
                </span>
              </div>
            )}
            {d.reconciliation_warnings.length > 0 && (
              <ul className="text-xs text-amber-600 list-disc pl-4 space-y-1">
                {d.reconciliation_warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {d.recent_bills.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/40">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                  {tu("op.recent_bills")}
                </p>
                <ul className="divide-y divide-border/40">
                  {d.recent_bills.slice(0, 5).map((b) => (
                    <li
                      key={b.id}
                      className="py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {b.bill_number ?? b.period_label ?? tu("billingTabs.bill")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {tu("bills.due")} {fmtDate(b.due_date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold tabular-nums">
                          {fmtINR(b.amount)}
                        </p>
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {b.status}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ),
        { emptyMessage: "No advanced financial activity." },
      )}
    </CardShell>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </p>
      <p className="text-sm font-bold tabular-nums truncate">{value}</p>
    </div>
  );
}

function OccupancyHistorySection({
  state,
}: {
  state: SectionState<OccupancyHistoryItem[]>;
}) {
  return (
    <CardShell title={tu("op.occupancy_history")} icon={History} proBadge>
      {renderSectionState<OccupancyHistoryItem[]>(
        state,
        (items) => (
          <ul className="divide-y divide-border/60">
            {items.slice(0, 10).map((h) => (
              <li key={`${h.user_id}-${h.moved_in_at ?? ""}`} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {h.display_name ?? tu("inc.k.resident")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {h.relationship ?? "—"} · {fmtDate(h.moved_in_at)} →{" "}
                    {h.moved_out_at ? fmtDate(h.moved_out_at) : tu("op.present_2")}
                  </p>
                </div>
                {h.is_active && (
                  <Badge
                    variant="outline"
                    className="rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]"
                  >
                    {tu("common.active")}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ),
        { emptyMessage: "No prior residents recorded." },
      )}
    </CardShell>
  );
}

function VehiclesSection({ state }: { state: SectionState<VehicleItem[]> }) {
  return (
    <CardShell title={tu("nav.vehicles")} icon={Car} proBadge>
      {renderSectionState<VehicleItem[]>(
        state,
        (items) => (
          <ul className="divide-y divide-border/60">
            {items.map((v) => (
              <li key={v.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{v.display_plate || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{v.type ?? "—"}</p>
                </div>
                {!v.is_active && (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    {tu("common.inactive")}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ),
        { emptyMessage: "No vehicles registered." },
      )}
    </CardShell>
  );
}

function NoDuesSection({ state, flatId }: { state: SectionState<SafeNoDuesSection>; flatId: string }) {
  const loadActivity = useServerFn(getFlatNoDuesActivity);
  const activity = useQuery({
    queryKey: ["flat-no-dues-activity", flatId],
    enabled: state.status === "available",
    staleTime: 30_000,
    queryFn: () => loadActivity({ data: { flatId } }),
  });
  const req = activity.data?.latestRequest ?? null;
  const cert = activity.data?.latestCertificate ?? null;
  return (
    <CardShell
      title={tu("mod.noDues")}
      icon={ShieldCheck}
      proBadge
      action={
        <Button asChild size="sm" variant="ghost" className="rounded-xl h-9 min-h-[36px]">
          <Link to="/society/no-dues">{tu("op.manage")}</Link>
        </Button>
      }
    >
      {renderSectionState<SafeNoDuesSection>(
        state,
        (d) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[11px]",
                  d.eligible
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20",
                )}
              >
                {d.eligible ? tu("op.eligible") : tu("op.not_eligible")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {tu("sd.m.outstanding")} {fmtINR(d.total_outstanding)}
              </span>
            </div>
            {d.blocker_count > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {tu("op.blockers")}{d.blocker_count})
                </p>
                <ul className="text-xs text-amber-700 list-disc pl-4 mt-1 space-y-0.5">
                  {d.blocker_labels.slice(0, 5).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-xl border bg-muted/30 p-3 text-xs space-y-1">
              {activity.isLoading ? <p className="text-muted-foreground">{tu("op.loading_no_dues_history")}</p>
                : activity.isError ? <p className="text-destructive">{tu("op.couldn_t_load_no_dues")}</p>
                : <>
                    <p>{req ? <>{tu("op.latest_request")} <span className="font-medium capitalize">{req.status.replace(/_/g, " ")}</span> · {new Date(req.submittedAt).toLocaleDateString("en-IN")}</> : tu("op.no_no_dues_request_from")}</p>
                    {cert && <p>{tu("nd.cert")} {cert.number}{cert.revoked ? tu("op.revoked") : ""} · issued {new Date(cert.issuedAt).toLocaleDateString("en-IN")}</p>}
                  </>}
              <p className="text-muted-foreground">{tu("op.eligibility_above_comes_from_the")}</p>
            </div>
            <Button asChild size="sm" className="min-h-11 w-full rounded-xl">
              {req
                ? <Link to="/society/no-dues/$id" params={{ id: req.id }}>{["submitted", "under_review", "blocked_by_dues"].includes(req.status) ? tu("op.review_no_dues_request") : tu("op.open_no_dues_request")}</Link>
                : <Link to="/society/no-dues">{tu("op.go_to_no_dues")}</Link>}
            </Button>
          </div>
        ),
      )}
    </CardShell>
  );
}

function DeterministicSummaryCard({ state }: { state: SectionState<UnitSummary> }) {
  return (
    <CardShell title={tu("op.unit_summary")} icon={ListChecks} proBadge>
      {renderSectionState<UnitSummary>(state, (s) => (
        <div className="space-y-2">
          <p className="text-sm font-medium">{s.headline}</p>
          {s.facts.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
              {s.facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {s.warnings.length > 0 && (
            <ul className="text-xs text-amber-600 list-disc pl-4 space-y-1">
              {s.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {s.next_actions.some((a) => a.type !== "none" && isAIAllowedRoute(a.route)) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {s.next_actions
                .filter((a) => a.type !== "none" && isAIAllowedRoute(a.route))
                .map((a, i) => {
                  const safeRoute = a.route!;
                  if (!isAIAllowedRoute(safeRoute)) return null;
                  return (
                    <Button
                      key={i}
                      asChild
                      size="sm"
                      variant="outline"
                      className="rounded-xl h-11 min-h-[44px]"
                    >
                      <Link to={safeRoute}>{a.label}</Link>
                    </Button>
                  );
                })}
            </div>
          )}
        </div>
      ))}
    </CardShell>
  );
}

function UnsupportedOpsSection({
  title,
  icon: Icon,
  state,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  state: SectionState<unknown>;
}) {
  if (state.status === "locked") return null;
  return (
    <li className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{title}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {state.status === "error"
          ? tu("hd.unavailable")
          : state.status === "unsupported"
            ? tu("op.not_available_yet")
            : state.status === "empty"
              ? tu("el.a.none")
              : ""}
      </span>
    </li>
  );
}

/** Secondary modules grouped into one list instead of a stack of dashed cards. */
function OtherRecords({
  items,
}: {
  items: { title: string; icon: React.ComponentType<{ className?: string }>; state: SectionState<unknown> }[];
}) {
  const visible = items.filter((i) => i.state.status !== "locked");
  if (!visible.length) return null;
  return (
    <section aria-label={tu("op.other_records")} className="overflow-hidden rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{tu("op.other_records")}</h3>
      <ul className="divide-y divide-border">
        {visible.map((i) => <UnsupportedOpsSection key={i.title} {...i} />)}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function FlatDetailPage() {
  const { id } = Route.useParams();
  const loadSnapshot = useServerFn(getFlat360);
  const generateAI = useServerFn(generateFlat360AISummaryFn);
  const queryClient = useQueryClient();

  const [aiTriggered, setAiTriggered] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: ["flat360", id],
    enabled: !!id,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      const msg = safeErrMessage(error);
      if (msg.includes("NOT_AUTHORIZED") || msg.includes("FLAT_NOT_FOUND")) return false;
      return failureCount < 1;
    },
    queryFn: () => loadSnapshot({ data: { flatId: id } }),
  });

  const snapshot = snapshotQuery.data;
  const canViewAdvanced = snapshot?.viewer.canViewAdvanced ?? false;
  const aiAllowed = snapshot?.aiSummary.entitlement === "available";

  const aiQuery = useQuery({
    queryKey: ["flat360-ai", id],
    enabled: !!snapshot && aiAllowed && aiTriggered,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => generateAI({ data: { flatId: id } }),
  });

  const refreshMutation = useMutation({
    mutationFn: () => generateAI({ data: { flatId: id, forceRefresh: true } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["flat360-ai", id], data);
    },
  });

  /* ---- Loading / error / not-found ---- */
  if (snapshotQuery.isLoading) {
    return (
      <PageShell>
        <div className="space-y-3">
          <div className="h-24 rounded-2xl bg-muted animate-pulse" />
          <div className="h-32 rounded-2xl bg-muted animate-pulse" />
          <div className="h-32 rounded-2xl bg-muted animate-pulse" />
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {tu("op.loading_flat_details")}
        </div>
      </PageShell>
    );
  }

  if (snapshotQuery.error) {
    const msg = safeErrMessage(snapshotQuery.error);
    const isAuth = msg.includes("NOT_AUTHORIZED");
    const isMissing = msg.includes("FLAT_NOT_FOUND");
    return (
      <PageShell>
        <div className="flex items-center gap-2 mb-3">
          <Button asChild variant="ghost" size="sm" className="rounded-xl">
            <Link to="/society/flats">
              <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              {tu("nav.flats")}
            </Link>
          </Button>
        </div>
        <Card className="rounded-2xl">
          <CardContent className="p-6 text-center space-y-2">
            <div className="h-12 w-12 mx-auto rounded-2xl bg-muted grid place-items-center">
              {isAuth ? (
                <Lock className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Home className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <h1 className="text-lg font-semibold">
              {isAuth
                ? tu("op.access_denied")
                : isMissing
                  ? tu("op.flat_not_found")
                  : tu("op.could_not_load_flat")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isAuth
                ? tu("op.you_don_t_have_permission")
                : isMissing
                  ? tu("op.this_flat_may_have_been")
                  : tu("op.please_try_again_in_a")}
            </p>
            <Button asChild variant="outline" className="rounded-xl mt-2">
              <Link to="/society/flats">{tu("op.back_to_flats")}</Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (!snapshot) {
    return (
      <PageShell>
        <p className="text-muted-foreground">{tu("op.flat_not_available")}</p>
      </PageShell>
    );
  }

  /* ---- AI state ---- */
  const aiState: AISummaryUiState = !aiAllowed
    ? { kind: "locked" }
    : !aiTriggered
      ? { kind: "loading" } // trigger on mount effect
      : aiQuery.isLoading || refreshMutation.isPending
        ? aiQuery.data
          ? { kind: "response", response: aiQuery.data }
          : { kind: "loading" }
        : aiQuery.error
          ? { kind: "error" }
          : aiQuery.data
            ? { kind: "response", response: aiQuery.data }
            : { kind: "loading" };

  return (
    <PageShell>
      <div className="flex items-center gap-2 mb-3">
        <Button asChild variant="ghost" size="sm" className="rounded-xl">
          <Link to="/society/flats">
            <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            {tu("nav.flats")}
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        <IdentityHeader snapshot={snapshot} />
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          <OccupancySection snapshot={snapshot} />
          <BasicFinancialSection snapshot={snapshot} />
        </div>
        <FlatLifecyclePanel flatId={id} />

        {/* Basic locked experience */}
        {!canViewAdvanced && (
          <>
            <UpgradePrompt feature="flat_360" currentPlan={snapshot.viewer.plan} />
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p className="text-sm font-semibold text-foreground mb-1">
                      {tu("op.unlock_flat_360_intelligence")}
                    </p>
                    <p>
                      {tu("op.upgrade_to_pro_for_occupancy")}
                    </p>
                    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 list-disc pl-4">
                      <li>{tu("op.advanced_finance")}</li>
                      <li>{tu("op.occupancy_history")}</li>
                      <li>{tu("nav.vehicles")}</li>
                      <li>{tu("mod.noDues")}</li>
                      <li>{tu("op.unit_summary")}</li>
                      <li>{tu("op.ai_summary")}</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

      </div>

      {/* Pro/Premium advanced sections: main history on the left, status + insights on the right */}
      {canViewAdvanced && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
          <div className="min-w-0 space-y-3">
            <OccupancyHistorySection state={snapshot.occupancyHistory} />
            <AdvancedFinanceSection state={snapshot.advancedFinancial} />
            <VehiclesSection state={snapshot.vehicles} />
          </div>
          <div className="min-w-0 space-y-3">
            <NoDuesSection state={snapshot.noDues} flatId={id} />
            <DeterministicSummaryCard state={snapshot.deterministicSummary} />
            <AISummaryTrigger onMount={() => setAiTriggered(true)} />
            <AISummarySlot
              state={aiState}
              canRefresh={!refreshMutation.isPending && !aiQuery.isLoading}
              onRefresh={() => refreshMutation.mutate()}
            />
            <OtherRecords
              items={[
                { title: "Visitors", icon: Users, state: snapshot.visitors as SectionState<unknown> },
                { title: "Complaints", icon: AlertTriangle, state: snapshot.complaints as SectionState<unknown> },
                { title: "Documents", icon: FileText, state: snapshot.documents as SectionState<unknown> },
                { title: "Approvals", icon: ArrowRight, state: snapshot.approvals as SectionState<unknown> },
                { title: "Notices", icon: FileText, state: snapshot.notices as SectionState<unknown> },
              ]}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}

/* Fires the AI query once after Pro sections mount. Kept as tiny component
   so the effect only runs when advanced is unlocked. */
function AISummaryTrigger({ onMount }: { onMount: () => void }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useOnce(onMount);
  return null;
}

function useOnce(fn: () => void) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Placeholder for Loader2 import usage in future tweak (kept for symmetry).
void Loader2;
