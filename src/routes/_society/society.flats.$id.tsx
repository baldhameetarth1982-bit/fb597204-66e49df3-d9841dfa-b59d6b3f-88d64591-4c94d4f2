import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Home,
  User,
  IndianRupee,
  Loader2,
  FileText,
  ArrowRight,
  History,
  DoorOpen,
  MapPin,
  Users,
  Car,
  UserCheck,
  LifeBuoy,
  CreditCard,
  Sparkles,
  BadgeCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { flatOutstanding, flatOccupancyHistory } from "@/lib/residents.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/flats/$id")({
  head: () => ({ meta: [{ title: "House — SocioHub" }] }),
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
        .select(
          "id, is_primary, relationship, moved_in_at, profiles(id, full_name, phone, email, avatar_url)",
        )
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

  const residentIds = (current ?? []).map((resident) => resident.profiles?.id).filter(Boolean);

  const { data: family } = useQuery({
    enabled: residentIds.length > 0,
    queryKey: ["flat-family-detail", id, residentIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("family_members")
        .select("id, user_id, full_name, relation, age, phone")
        .in("user_id", residentIds);
      return (data ?? []) as any[];
    },
  });

  const { data: vehicles } = useQuery({
    enabled: !!id,
    queryKey: ["flat-vehicles-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, type, make_model, color")
        .eq("flat_id", id)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: visitors } = useQuery({
    enabled: !!id,
    queryKey: ["flat-visitors-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("visitors")
        .select("id, visitor_name, purpose, status, entry_at, exit_at")
        .eq("flat_id", id)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []) as any[];
    },
  });

  const { data: tickets } = useQuery({
    enabled: residentIds.length > 0,
    queryKey: ["flat-tickets-detail", id, residentIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("id, subject, category, status, priority, created_at")
        .in("user_id", residentIds)
        .order("created_at", { ascending: false })
        .limit(8);
      return (data ?? []) as any[];
    },
  });

  const { data: payments } = useQuery({
    enabled: !!id,
    queryKey: ["flat-payments-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("id, amount, status, method, paid_at, reference_no")
        .eq("flat_id", id)
        .order("paid_at", { ascending: false })
        .limit(8);
      return (data ?? []) as any[];
    },
  });

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

  const primary = current?.find((r) => r.is_primary) ?? current?.[0];
  const isVacant = !current || current.length === 0;
  const pendingAmount = Number(outstanding?.pending ?? 0);
  const openTickets = (tickets ?? []).filter(
    (ticket) => ticket.status === "open" || ticket.status === "in_progress",
  ).length;
  const paidTotal = (payments ?? [])
    .filter((payment) => payment.status === "success")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const unitSummary = isVacant
    ? "This unit is vacant. Review any pending dues before assigning a new resident."
    : pendingAmount > 0
      ? `Occupied by ${primary?.profiles?.full_name ?? "a resident"}. ${moneySummary(pendingAmount)} is pending${openTickets ? ` and ${openTickets} helpdesk request${openTickets === 1 ? " is" : "s are"} still open` : ""}.`
      : `Occupied by ${primary?.profiles?.full_name ?? "a resident"}. Dues are clear${openTickets ? `, with ${openTickets} unresolved helpdesk request${openTickets === 1 ? "" : "s"}` : " and there are no unresolved helpdesk requests"}.`;

  return (
    <PageShell>
      <div className="flex items-center gap-2 mb-3">
        <Button asChild variant="ghost" size="sm" className="rounded-xl">
          <Link to="/society/flats">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Houses
          </Link>
        </Button>
      </div>

      {/* Flat 360 header */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-primary/10 grid place-items-center">
                <Home className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold">
                  {flat.blocks?.name ? `${flat.blocks.name} · ` : ""}
                  {flat.flat_number}
                </h1>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3" />
                  {flat.floor != null ? `Floor ${flat.floor}` : "Floor —"} · 360° unit view
                </p>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Snapshot icon={Users} label="Residents" value={current?.length ?? 0} />
        <Snapshot icon={Car} label="Vehicles" value={vehicles?.length ?? 0} />
        <Snapshot icon={LifeBuoy} label="Open tickets" value={openTickets} />
        <Snapshot
          icon={CreditCard}
          label="Recent paid"
          value={`₹${paidTotal.toLocaleString("en-IN")}`}
        />
      </div>

      <Card className="rounded-2xl border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Unit summary</p>
              <p className="mt-1 text-sm text-muted-foreground">{unitSummary}</p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden rounded-xl sm:inline-flex"
            >
              <Link to="/society/no-dues">
                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> No-dues
              </Link>
            </Button>
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

      <div className="grid gap-4 md:grid-cols-2">
        <ActivityCard
          icon={Users}
          title="Family members"
          empty="No family members added."
          items={(family ?? []).map((member) => ({
            id: member.id,
            title: member.full_name,
            subtitle: `${member.relation}${member.age ? ` · Age ${member.age}` : ""}`,
          }))}
        />
        <ActivityCard
          icon={Car}
          title="Vehicles"
          empty="No vehicles registered."
          items={(vehicles ?? []).map((vehicle) => ({
            id: vehicle.id,
            title: vehicle.plate_number,
            subtitle: [vehicle.type, vehicle.make_model, vehicle.color].filter(Boolean).join(" · "),
          }))}
        />
        <ActivityCard
          icon={UserCheck}
          title="Recent visitors"
          empty="No recent visitors."
          items={(visitors ?? []).map((visitor) => ({
            id: visitor.id,
            title: visitor.visitor_name,
            subtitle: `${visitor.purpose ?? "Visitor"} · ${visitor.status}`,
          }))}
        />
        <ActivityCard
          icon={LifeBuoy}
          title="Helpdesk"
          empty="No helpdesk requests."
          items={(tickets ?? []).map((ticket) => ({
            id: ticket.id,
            title: ticket.subject,
            subtitle: `${ticket.category.replace("_", " ")} · ${ticket.status.replace("_", " ")}`,
          }))}
        />
      </div>

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
                    <Badge
                      variant="outline"
                      className="rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]"
                    >
                      Active
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function moneySummary(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function Snapshot({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <Icon className="h-4 w-4 text-primary" />
        <p className="mt-2 text-lg font-bold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function ActivityCard({
  icon: Icon,
  title,
  empty,
  items,
}: {
  icon: typeof Users;
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; subtitle: string }>;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-4 w-4" /> {title}
        </h3>
        {items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.slice(0, 5).map((item) => (
              <li key={item.id} className="py-2.5">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="truncate text-[11px] capitalize text-muted-foreground">
                  {item.subtitle || "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
