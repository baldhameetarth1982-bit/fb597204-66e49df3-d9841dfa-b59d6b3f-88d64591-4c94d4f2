import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Home, User, IndianRupee, Loader2, FileText, ArrowRight,
  History, DoorOpen, MapPin, ListChecks,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { flatOutstanding, flatOccupancyHistory } from "@/lib/residents.functions";
import { cn } from "@/lib/utils";
import { buildUnitLabel } from "@/lib/unit-label";
import { buildUnitSummary, type Flat360SummaryInput } from "@/lib/unit-summary";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { LockedFeatureCard } from "@/components/subscription/LockedFeatureCard";
import { AISummarySlot } from "@/components/flat360/AISummarySlot";

export const Route = createFileRoute("/_society/society/flats/$id")({
  head: () => ({ meta: [{ title: "House — SociyoHub" }] }),
  component: HouseDetailPage,
});

function HouseDetailPage() {
  const { id } = Route.useParams();
  const getOutstanding = useServerFn(flatOutstanding);
  const getHistory = useServerFn(flatOccupancyHistory);

  const { data: flat, isLoading } = useQuery({
    queryKey: ["flat-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flats")
        .select("id, flat_number, floor, block_id, society_id, blocks(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: current } = useQuery({
    enabled: !!id,
    queryKey: ["flat-current-resident", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("flat_residents")
        .select("id, is_primary, relationship, moved_in_at, profiles(id, full_name, phone, email, avatar_url)")
        .eq("flat_id", id)
        .eq("is_active", true)
        .order("is_primary", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: outstanding } = useQuery({
    enabled: !!id,
    queryKey: ["flat-outstanding-detail", id],
    queryFn: async () => getOutstanding({ data: { flatId: id } }),
  });

  const { data: bills } = useQuery({
    enabled: !!id,
    queryKey: ["flat-bills-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("bills")
        .select("id, bill_number, period_label, amount, status, due_date, paid_at, bill_date")
        .eq("flat_id", id)
        .order("bill_date", { ascending: false })
        .limit(12);
      return (data ?? []) as any[];
    },
  });

  const { data: history } = useQuery({
    enabled: !!id,
    queryKey: ["flat-history-detail", id],
    queryFn: async () => getHistory({ data: { flatId: id } }),
  });

  // Hooks MUST come before conditional returns.
  const { hasFeature, isLoading: planLoading } = useFeatureAccess();
  const hasFlat360 = hasFeature("flat_360");

  const primary = current?.find((r) => r.is_primary) ?? current?.[0];
  const isVacant = !current || current.length === 0;
  const activeCount = current?.length ?? 0;

  // Deterministic Unit Summary — pure function, no AI, no PII.
  const unit_label = flat
    ? buildUnitLabel({
        flat_number: flat.flat_number,
        floor: flat.floor,
        block_name: flat.blocks?.name ?? null,
      })
    : "Unit";
  const is_serial = !(flat?.blocks?.name || flat?.floor != null);

  const summaryInput = useMemo<Flat360SummaryInput>(() => {
    const relationship = (primary?.relationship ?? "").toLowerCase();
    let occKind: Flat360SummaryInput["occupancy"]["kind"] = "unknown";
    if (isVacant) occKind = "vacant";
    else if (activeCount > 1) occKind = "multi_resident";
    else if (relationship.includes("owner")) occKind = "owner_occupied";
    else if (relationship.includes("tenant") || relationship.includes("rent")) occKind = "tenant_occupied";
    else occKind = "owner_occupied";

    const out = Number(outstanding?.pending ?? 0);
    const overdue = Number(outstanding?.overdue_count ?? 0);
    const unpaid = (bills ?? []).filter((b) => b.status === "unpaid").length;

    return {
      unit_label,
      is_serial,
      occupancy: { kind: occKind, active_count: activeCount },
      financial: {
        total_outstanding: out,
        overdue_count: overdue,
        partial_count: 0,
        unpaid_count: unpaid,
        pending_verification_count: 0,
        inconsistency_count: 0,
      },
      complaints: { status: "unsupported" },
      approvals: { status: "unsupported" },
      no_dues: { status: "unavailable" },
      errors: [],
    };
  }, [unit_label, is_serial, isVacant, activeCount, primary, outstanding, bills]);

  const summary = useMemo(() => buildUnitSummary(summaryInput), [summaryInput]);

  if (isLoading) {
    return (
      <PageShell>
        <div className="grid place-items-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }
  if (!flat) {
    return (
      <PageShell>
        <p className="text-muted-foreground">House not found.</p>
      </PageShell>
    );
  }



  return (
    <PageShell>
      <div className="flex items-center gap-2 mb-3">
        <Button asChild variant="ghost" size="sm" className="rounded-xl">
          <Link to="/society/flats"><ArrowLeft className="h-4 w-4 mr-1" />Houses</Link>
        </Button>
      </div>

      {/* Header card */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-primary/10 grid place-items-center">
                <Home className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold">
                  {buildUnitLabel({
                    flat_number: flat.flat_number,
                    floor: flat.floor,
                    block_name: flat.blocks?.name ?? null,
                  })}
                </h1>
                {(flat.blocks?.name || flat.floor != null) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {flat.floor != null ? `Floor ${flat.floor}` : "Direct unit"}
                  </p>
                )}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full shrink-0",
                isVacant
                  ? "bg-muted text-muted-foreground"
                  : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
              )}
            >
              {isVacant ? "Vacant" : "Occupied"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Outstanding */}
      {outstanding && (Number(outstanding.pending) > 0 || outstanding.overdue_count > 0) && (
        <Card className="rounded-2xl border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-500/10 grid place-items-center shrink-0">
              <IndianRupee className="h-5 w-5 text-rose-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-lg font-bold text-rose-600">
                ₹{Number(outstanding.pending).toLocaleString("en-IN")}
              </p>
              {outstanding.overdue_count > 0 && (
                <p className="text-[11px] text-rose-600/80">{outstanding.overdue_count} overdue</p>
              )}
            </div>
            <Button asChild size="sm" className="rounded-xl shrink-0">
              <Link to="/society/billing/generate">Generate Bill</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current resident */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Current resident</h3>
            {current && current.length > 1 && (
              <span className="text-[11px] text-muted-foreground">{current.length} people</span>
            )}
          </div>
          {isVacant ? (
            <div className="text-sm text-muted-foreground py-3 flex items-center gap-2">
              <DoorOpen className="h-4 w-4" /> No active resident.
            </div>
          ) : (
            <div className="space-y-2">
              {primary && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center shrink-0">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {primary.profiles?.full_name ?? "Resident"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {primary.profiles?.phone ?? primary.profiles?.email ?? "—"}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="rounded-xl shrink-0">
                    <Link to="/society/residents/$id" params={{ id: primary.profiles.id }}>
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent bills */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <FileText className="h-4 w-4" /> Recent bills
            </h3>
            <Button asChild variant="ghost" size="sm" className="rounded-xl">
              <Link to="/society/billing">All bills</Link>
            </Button>
          </div>
          {!bills || bills.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No bills yet.</p>
          ) : (
            <ul className="divide-y">
              {bills.map((b) => (
                <li key={b.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {b.bill_number ?? b.period_label ?? "Bill"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.bill_date ? new Date(b.bill_date).toLocaleDateString("en-IN") : "—"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">
                      ₹{Number(b.amount).toLocaleString("en-IN")}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px]",
                        b.status === "paid"
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : b.status === "cancelled"
                          ? "bg-muted text-muted-foreground"
                          : "bg-amber-500/10 text-amber-600 border-amber-500/20",
                      )}
                    >
                      {b.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Occupancy history */}
      {history && history.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <History className="h-4 w-4" /> Occupancy history
            </h3>
            <ul className="divide-y">
              {history.map((h: any) => (
                <li key={h.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {h.profiles?.full_name ?? "Resident"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {h.moved_in_at ? new Date(h.moved_in_at).toLocaleDateString("en-IN") : "—"}
                      {" → "}
                      {h.moved_out_at
                        ? new Date(h.moved_out_at).toLocaleDateString("en-IN")
                        : "present"}
                    </p>
                  </div>
                  {h.is_active && (
                    <Badge variant="outline" className="rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                      Active
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* --- Pro / Premium: Deterministic Unit Summary --- */}
      {planLoading ? null : hasFlat360 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <ListChecks className="h-4 w-4" /> Unit summary
              </h3>
              <Badge variant="outline" className="rounded-full text-[10px]">
                Pro
              </Badge>
            </div>
            <p className="text-sm font-medium">{summary.headline}</p>
            {summary.facts.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                {summary.facts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {summary.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-600 list-disc pl-4">
                {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {summary.next_actions.some((a) => a.type !== "none") && (
              <div className="mt-3 flex flex-wrap gap-2">
                {summary.next_actions
                  .filter((a) => a.type !== "none" && a.route)
                  .map((a, i) => (
                    <Button
                      key={i}
                      asChild
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                    >
                      <a href={a.route}>{a.label}</a>
                    </Button>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <LockedFeatureCard
          feature="flat_360"
          message="Unlock the full Flat 360 experience: unit summary, advanced financial insight, occupancy history, and safe No-Dues integration."
        />
      )}

      {/* --- Pro / Premium: AI Summary slot (provider next turn) --- */}
      {hasFlat360 && <AISummarySlot contract={{ state: "not_implemented" }} />}
    </PageShell>
  );
}
