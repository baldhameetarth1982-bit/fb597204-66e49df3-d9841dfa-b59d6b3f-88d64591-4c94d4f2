import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, Loader2, KeyRound, UserPlus, Search, Car, X, RefreshCw, Check, Repeat, AlertTriangle, ParkingSquare, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { HardwareNote, IncidentSheet, OfflineQueuePanel, ParkingSheet, ReasonSheet, RecurringSheet, SosAlertsCard, useOnline } from "@/components/gate/GateOps";
import { enqueue } from "@/lib/gate-offline";
import { cn } from "@/lib/utils";
import { GATE_CATEGORIES as VISITOR_CATEGORIES, categoryLabel, fmtTime, gateErrorMessage, statusMeta } from "@/lib/visitors";

export const Route = createFileRoute("/_resident/app/guard")({
  head: () => ({
    meta: [
      { title: "Gate — SociyoHub" },
      { name: "description", content: "Fast visitor check-in, check-out and vehicle checks for society guards." },
    ],
  }),
  component: GuardDashboard,
});

type Scope = "today" | "expected" | "inside" | "overstay" | "history";
interface GateRow {
  id: string; visitor_name: string; phone_last4: string | null; category: string; purpose: string | null;
  flat_label: string | null; vehicle_number: string | null; status: string; pre_approved: boolean;
  expected_at: string | null; valid_until: string | null; entry_at: string | null; exit_at: string | null; created_at: string;
}
const SCOPES: { v: Scope; label: string }[] = [
  { v: "today", label: "Today" },
  { v: "expected", label: "Expected" },
  { v: "inside", label: "Inside" },
  { v: "overstay", label: "Overstay" },
  { v: "history", label: "History" },
];
const EMPTY = { flat: "", name: "", phone: "", category: "guest", purpose: "", vehicle: "" };

function GuardDashboard() {
  const { roles, isLoading } = useAuth();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("today");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [walkOpen, setWalkOpen] = useState(false);
  const [walk, setWalk] = useState(EMPTY);
  const [walkBusy, setWalkBusy] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);
  const [recurOpen, setRecurOpen] = useState(false);
  const [incident, setIncident] = useState<{ open: boolean; visitorId?: string | null }>({ open: false });
  const [forceExit, setForceExit] = useState<string | null>(null);
  const [parking, setParking] = useState<{ id: string; current: string | null } | null>(null);
  const online = useOnline();

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const allowed = ["security", "society_admin", "block_admin"].some((r) => roles.includes(r as never));
  const key = ["gate", scope, dq] as const;
  const list = useQuery({
    queryKey: key,
    enabled: allowed,
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guard_gate_list", { _q: dq || undefined, _scope: scope });
      if (error) throw error;
      return (data ?? []) as GateRow[];
    },
  });

  const ids = (list.data ?? []).map((r) => r.id);
  const flags = useQuery({
    queryKey: ["gate", "flags", ids.join(",")],
    enabled: allowed && ids.length > 0 && online,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guard_visitor_flags", { _ids: ids });
      if (error) throw error;
      return new Map((data ?? []).map((f: { id: string; restricted: boolean; needs_committee: boolean; overridden: boolean; parking_label: string | null }) => [f.id, f]));
    },
  });

  if (isLoading) return null;
  if (!allowed) return <Navigate to="/app/dashboard" />;

  const refresh = () => qc.invalidateQueries({ queryKey: ["gate"] });

  async function checkinByCode() {
    if (!/^\d{6}$/.test(code) || codeBusy) return;
    setCodeBusy(true);
    const { data, error } = await supabase.rpc("guard_checkin_code", { _code: code });
    setCodeBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    const r = (data as { visitor_name: string; flat_label: string | null }[])?.[0];
    toast.success(`${r?.visitor_name ?? "Visitor"} checked in${r?.flat_label ? ` · ${r.flat_label}` : ""}`);
    setCode("");
    refresh();
  }

  async function act(id: string, action: "checkin" | "checkout" | "deny", name = "") {
    if (busyId) return;
    if (!online) {
      if (action !== "checkout") return toast.error("Connection required. Letting people in or denying needs a live check.");
      enqueue("checkout", name || "Visitor", { visitor_id: id });
      return toast.message("Saved offline — will be sent when you're back online");
    }
    setBusyId(id);
    const { error } = await supabase.rpc("guard_visitor_action", { _id: id, _action: action });
    setBusyId(null);
    if (error) { toast.error(gateErrorMessage(error)); refresh(); return; }
    toast.success(action === "checkin" ? "Checked in" : action === "checkout" ? "Checked out" : "Entry denied");
    refresh();
  }

  async function submitWalkin(e: React.FormEvent) {
    e.preventDefault();
    if (walkBusy) return;
    if (!online) {
      try {
        enqueue("walkin", `${walk.name} · ${walk.flat}`, { flat_label: walk.flat, name: walk.name, phone: walk.phone, category: walk.category, purpose: walk.purpose, vehicle: walk.vehicle });
      } catch (err) {
        return toast.error(String((err as Error).message) === "flat_required_offline" ? "Offline walk-ins need a house number so a resident can approve." : "Offline list is full. Reconnect to continue.");
      }
      toast.message("Saved offline — the resident is asked once you're back online");
      setWalk(EMPTY); setWalkOpen(false); return;
    }
    setWalkBusy(true);
    const { error } = await supabase.rpc("guard_log_walkin", {
      _flat_label: walk.flat, _name: walk.name, _phone: walk.phone, _category: walk.category,
      _purpose: walk.purpose, _vehicle: walk.vehicle,
    });
    setWalkBusy(false);
    if (error) return toast.error(gateErrorMessage(error)); // form kept for retry
    toast.success(walk.flat || walk.category === "mover" ? "Sent for approval" : "Visitor logged inside");
    setWalk(EMPTY);
    setWalkOpen(false);
    refresh();
  }

  const rows = list.data ?? [];

  return (
    <div className="px-4 py-5 space-y-4 pb-28 max-w-xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gate</h1>
          <p className="text-sm text-muted-foreground">Check visitors in and out</p>
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={refresh} aria-label="Refresh">
          <RefreshCw className={cn("h-5 w-5", list.isFetching && "animate-spin")} />
        </Button>
      </header>

      <SosAlertsCard />
      <OfflineQueuePanel onSynced={refresh} />

      <Card className="rounded-2xl border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-2">
          <Label htmlFor="gate-code" className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-primary" /> Visitor pass code
          </Label>
          <div className="flex gap-2">
            <Input
              id="gate-code"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && checkinByCode()}
              className="h-14 text-2xl font-mono tracking-[0.4em] text-center"
            />
            <Button onClick={checkinByCode} disabled={codeBusy || code.length !== 6} className="h-14 px-5 rounded-xl">
              {codeBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><LogIn className="h-5 w-5 mr-1" />In</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Gate actions stay pinned above the bottom nav on phones for one-thumb reach. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-1 grid grid-cols-2 gap-2 rounded-2xl border bg-background/95 p-1 shadow-sm backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <Button onClick={() => setWalkOpen(true)} className="h-14 rounded-xl text-base">
          <UserPlus className="h-5 w-5 mr-2" /> Walk-in
        </Button>
        <Button onClick={() => setPlateOpen(true)} variant="outline" className="h-14 rounded-xl text-base">
          <Car className="h-5 w-5 mr-2" /> Check vehicle
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12 rounded-xl" disabled={!online} onClick={() => setRecurOpen(true)}><Repeat className="h-4 w-4 mr-2" />Regular visitors</Button>
        <Button variant="outline" className="h-12 rounded-xl" disabled={!online} onClick={() => setIncident({ open: true })}><AlertTriangle className="h-4 w-4 mr-2" />Report incident</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label="Search visitors"
          placeholder="Name, house, vehicle or last 4 digits"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9 h-12 rounded-xl"
        />
      </div>

      <div role="tablist" className="grid grid-cols-5 gap-1 rounded-2xl bg-muted p-1">
        {SCOPES.map((s) => (
          <button
            key={s.v}
            role="tab"
            aria-selected={scope === s.v}
            onClick={() => setScope(s.v)}
            className={cn(
              "min-h-11 rounded-xl text-xs sm:text-sm font-medium transition-colors",
              scope === s.v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : list.isError && rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">{gateErrorMessage(list.error)}</p>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => list.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">
          {dq ? "No visitors match your search." : scope === "inside" ? "Nobody is inside right now." : scope === "overstay" ? "Nobody has overstayed." : scope === "expected" ? "No expected visitors." : "No visitors yet today."}
        </CardContent></Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => {
            const m = statusMeta(v.status);
            const busy = busyId === v.id;
            const f = flags.data?.get(v.id);
            const inside = v.status === "inside" || v.status === "overstayed";
            const blocked = !!f?.restricted && !f?.overridden;
            const canIn = (v.status === "approved" || v.status === "expected" || v.status === "pending") && !blocked;
            const canDeny = v.status === "approved" || v.status === "expected" || v.status === "pending" || v.status === "awaiting";
            return (
              <li key={v.id}>
                <Card className="rounded-2xl">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold truncate">{v.visitor_name}</p>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", m.className)}>{m.label}</span>
                          {f?.restricted && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-destructive/10 text-destructive inline-flex items-center gap-1"><ShieldAlert className="h-3 w-3" />{f.overridden ? "Restricted · committee allowed" : "Restricted"}</span>}
                          {f?.needs_committee && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-warning/15 text-warning-foreground">Committee decision</span>}
                          {f?.parking_label && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary">P {f.parking_label}</span>}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {v.flat_label ? `House ${v.flat_label}` : "No house"} · {v.purpose || categoryLabel(v.category)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {v.vehicle_number ? `${v.vehicle_number} · ` : ""}
                          {v.phone_last4 ? `Phone ••${v.phone_last4} · ` : ""}
                          {v.exit_at ? `Out ${fmtTime(v.exit_at)}` : inside ? `In ${fmtTime(v.entry_at)}` : v.expected_at ? `Expected ${fmtTime(v.expected_at)}` : fmtTime(v.created_at)}
                        </p>
                      </div>
                    </div>
                    {(canIn || canDeny || inside) && (
                      <div className="flex gap-2 flex-wrap">
                        {inside && (
                          <Button className="flex-1 h-12 rounded-xl" variant="secondary" disabled={busy} onClick={() => act(v.id, "checkout", v.visitor_name)}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LogOut className="h-4 w-4 mr-2" />Check out</>}
                          </Button>
                        )}
                        {canIn && (
                          <Button className="flex-1 h-12 rounded-xl" disabled={busy} onClick={() => act(v.id, "checkin")}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-2" />Let in</>}
                          </Button>
                        )}
                        {inside && online && (
                          <>
                            <Button variant="outline" className="h-12 rounded-xl px-3" aria-label="Visitor parking" onClick={() => setParking({ id: v.id, current: f?.parking_label ?? null })}><ParkingSquare className="h-4 w-4" /></Button>
                            <Button variant="ghost" className="h-12 rounded-xl px-3 text-xs" onClick={() => setForceExit(v.id)}>Force exit</Button>
                          </>
                        )}
                        {blocked && <p className="w-full text-xs text-destructive">On the restricted list — the committee must decide before entry.</p>}
                        {canDeny && (
                          <Button variant="outline" className="h-12 rounded-xl px-4" disabled={busy} onClick={() => act(v.id, "deny")} aria-label="Deny entry">
                            <X className="h-4 w-4 mr-1" />Deny
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={walkOpen} onOpenChange={setWalkOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Walk-in visitor</SheetTitle></SheetHeader>
          <form onSubmit={submitWalkin} className="space-y-4 py-4">
            <div className="flex flex-wrap gap-2">
              {VISITOR_CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setWalk({ ...walk, category: c.value })}
                  className={cn(
                    "min-h-11 px-4 rounded-full border text-sm font-medium",
                    walk.category === c.value ? "bg-primary text-primary-foreground border-primary" : "border-border",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="w-flat">House</Label><Input id="w-flat" className="h-12" value={walk.flat} onChange={(e) => setWalk({ ...walk, flat: e.target.value })} placeholder="A-101" autoCapitalize="characters" /></div>
              <div><Label htmlFor="w-name">Name *</Label><Input id="w-name" className="h-12" value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="w-phone">Phone</Label><Input id="w-phone" className="h-12" inputMode="tel" value={walk.phone} onChange={(e) => setWalk({ ...walk, phone: e.target.value })} /></div>
              <div><Label htmlFor="w-veh">Vehicle</Label><Input id="w-veh" className="h-12" value={walk.vehicle} onChange={(e) => setWalk({ ...walk, vehicle: e.target.value })} autoCapitalize="characters" /></div>
            </div>
            <div><Label htmlFor="w-purpose">Purpose</Label><Input id="w-purpose" className="h-12" value={walk.purpose} onChange={(e) => setWalk({ ...walk, purpose: e.target.value })} placeholder="e.g. Amazon parcel" /></div>
            <p className="text-xs text-muted-foreground">With a house number, the residents get an alert to approve or deny. Movers and restricted people go to the committee. Without a house, the visitor is logged as inside.{!online && " You're offline: this will be saved and sent later."}</p>
            <Button type="submit" className="w-full h-14 rounded-xl text-base" disabled={walkBusy}>
              {walkBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : walk.flat ? "Ask resident" : "Log entry"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <PlateSheet open={plateOpen} onOpenChange={setPlateOpen} />
      <RecurringSheet open={recurOpen} onOpenChange={setRecurOpen} onDone={refresh} />
      <IncidentSheet open={incident.open} visitorId={incident.visitorId} onOpenChange={(o) => setIncident({ open: o })} />
      <ParkingSheet visitorId={parking?.id ?? null} current={parking?.current ?? null} onOpenChange={(o) => !o && setParking(null)} onDone={refresh} />
      <ReasonSheet title="Force exit" hint="Use when a visitor left without being checked out. This is recorded separately as an override."
        open={!!forceExit} onOpenChange={(o) => !o && setForceExit(null)}
        onSubmit={async (reason) => {
          const { error } = await supabase.rpc("gate_override", { _id: forceExit!, _action: "force_exit", _reason: reason });
          if (error) { toast.error(gateErrorMessage(error)); return false; }
          toast.success("Marked as left"); refresh(); return true;
        }} />
      <HardwareNote />
    </div>
  );
}

interface PlateRow { plate_number: string; vehicle_type: string; make_model: string | null; color: string | null; flat_label: string | null; parking_label: string | null }

function PlateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PlateRow[] | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("guard_verify_vehicle", { _plate: plate });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    setRes((data ?? []) as PlateRow[]);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setRes(null); setPlate(""); } }}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader><SheetTitle>Check a vehicle</SheetTitle></SheetHeader>
        <form onSubmit={check} className="flex gap-2 py-4">
          <Input aria-label="Number plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="GJ01AB1234" className="h-14 text-lg font-mono" autoFocus />
          <Button type="submit" className="h-14 rounded-xl px-5" disabled={busy || plate.trim().length < 3}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Check"}
          </Button>
        </form>
        {res && (res.length === 0 ? (
          <div className="rounded-2xl bg-destructive/10 text-destructive p-4 text-sm font-medium mb-4">Not registered in this society</div>
        ) : (
          <ul className="space-y-2 pb-4">
            {res.map((r) => (
              <li key={r.plate_number} className="rounded-2xl bg-success/10 p-4">
                <p className="font-mono font-semibold">{r.plate_number}</p>
                <p className="text-sm text-muted-foreground">
                  {[r.vehicle_type, r.make_model, r.color].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm">{r.flat_label ? `House ${r.flat_label}` : "No house linked"}{r.parking_label ? ` · Parking ${r.parking_label}` : ""}</p>
              </li>
            ))}
          </ul>
        ))}
      </SheetContent>
    </Sheet>
  );
}
