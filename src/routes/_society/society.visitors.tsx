import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, UserCheck, Plus, Check, X, LogOut, Download } from "lucide-react";
import {
  StatusChip,
  SummaryStrip,
  ListSkeleton,
  LoadError,
  ListEmpty,
  SearchField,
  SegmentedFilter,
} from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { gateErrorMessage } from "@/lib/visitors";
import { SecurityAdminPanel } from "@/components/gate/SecurityAdminPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/visitors")({
  head: () => ({
    meta: [
      { title: "Visitor log — SociyoHub" },
      { name: "description", content: "Gate activity: waiting, inside and completed visits." },
      { property: "og:title", content: "Visitor log — SociyoHub" },
      {
        property: "og:description",
        content: "Gate activity: waiting, inside and completed visits.",
      },
    ],
  }),
  component: () => (
    <FeatureGate feature="visitors">
      <SocietyVisitors />
    </FeatureGate>
  ),
});

interface V {
  id: string;
  visitor_name: string;
  phone: string | null;
  vehicle_number: string | null;
  purpose: string | null;
  entry_at: string;
  exit_at: string | null;
  flat_number: string | null;
  status: string | null;
  pre_approved: boolean | null;
}

type Filter = "all" | "pending" | "inside" | "exited";

// "pending" tab = anything not yet inside and not finished (expected passes and
// walk-ins waiting for a resident). Finished states fall under "exited".
function computeStatus(v: V): Filter {
  if (v.exit_at) return "exited";
  if (["pending", "expected", "awaiting", "approved"].includes(v.status ?? "")) return "pending";
  if (["denied", "rejected", "cancelled", "expired"].includes(v.status ?? "")) return "exited";
  return "inside";
}

function SocietyVisitors() {
  const { user } = useAuth();
  const { societyId, loading: sl } = useSocietyId();
  const [list, setList] = useState<V[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loadFailed, setLoadFailed] = useState(false);
  const [denyFor, setDenyFor] = useState<V | null>(null);
  const [form, setForm] = useState({
    visitor_name: "",
    phone: "",
    vehicle_number: "",
    purpose: "",
    flat_number: "",
  });

  const loadCtl = useRef<AbortController | null>(null);
  async function load() {
    if (!societyId) return;
    // Skip background polls while the screen is hidden; cancel any older in-flight read.
    if (typeof document !== "undefined" && document.hidden && loadCtl.current) return;
    loadCtl.current?.abort();
    const ctl = new AbortController();
    loadCtl.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 15000);
    const { data, error } = await supabase
      .from("visitors")
      .select(
        "id, visitor_name, phone, vehicle_number, purpose, entry_at, exit_at, flat_number, status, pre_approved",
      )
      .eq("society_id", societyId)
      .order("entry_at", { ascending: false })
      .limit(200)
      .abortSignal(ctl.signal);
    clearTimeout(timer);
    if (loadCtl.current !== ctl) return; // superseded or unmounted
    if (error) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setLoadFailed(false);
    setList((data as V[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    if (societyId) {
      void load();
      const t = setInterval(load, 30000);
      return () => { clearInterval(t); loadCtl.current?.abort(); loadCtl.current = null; };
    } else if (!sl) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId, sl]);

  const filtered = useMemo(
    () => (filter === "all" ? list : list.filter((v) => computeStatus(v) === filter)),
    [list, filter],
  );

  const counts = useMemo(
    () => ({
      pending: list.filter((v) => computeStatus(v) === "pending").length,
      inside: list.filter((v) => computeStatus(v) === "inside").length,
      exited: list.filter((v) => computeStatus(v) === "exited").length,
    }),
    [list],
  );

  async function logVisitor() {
    if (!user || !societyId || !form.visitor_name.trim())
      return toast.error(tu("op.visitor_name_required"));
    setSaving(true);
    const { error } = await supabase.rpc("guard_log_walkin", {
      _flat_label: form.flat_number.trim(),
      _name: form.visitor_name.trim(),
      _phone: form.phone.trim(),
      _category: "guest",
      _purpose: form.purpose.trim(),
      _vehicle: form.vehicle_number.trim(),
    });
    setSaving(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("op.visitor_logged"));
    setForm({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" });
    setOpen(false);
    void load();
  }

  async function approve(id: string) {
    const { error } = await supabase.rpc("guard_visitor_action", { _id: id, _action: "checkin" });
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("op.visitor_checked_in"));
    void load();
  }
  async function reject(id: string) {
    const { error } = await supabase.rpc("guard_visitor_action", { _id: id, _action: "deny" });
    if (error) return toast.error(gateErrorMessage(error));
    void load();
  }
  async function markExit(id: string) {
    const { error } = await supabase.rpc("guard_visitor_action", { _id: id, _action: "checkout" });
    if (error) return toast.error(gateErrorMessage(error));
    void load();
  }

  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  async function checkinByCode() {
    if (!societyId || !/^\d{6}$/.test(code)) return toast.error(tu("op.enter_the_6_digit_pass"));
    setCodeBusy(true);
    const { error } = await supabase.rpc("guard_checkin_by_code", { _society_id: societyId, _code: code });
    setCodeBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("op.visitor_checked_in"));
    setCode("");
    void load();
  }

  function exportCsv() {
    // Prefix cells that a spreadsheet could treat as a formula.
    const cell = (x: unknown) => {
      let s = x == null ? "" : String(x);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const t = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
    const rows = [
      ["Visitor", "Phone", "Vehicle", "Purpose", "House", "Status", "Entry", "Exit"],
      ...shown.map((v) => [v.visitor_name, v.phone, v.vehicle_number, v.purpose, v.flat_number, v.status, t(v.entry_at), t(v.exit_at)]),
    ];
    const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `visitor-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const [term, setTerm] = useState("");
  const shown = useMemo(() => {
    const s = term.trim().toLowerCase();
    return filtered.filter(
      (v) =>
        !s ||
        `${v.visitor_name} ${v.flat_number ?? ""} ${v.vehicle_number ?? ""} ${v.purpose ?? ""}`
          .toLowerCase()
          .includes(s),
    );
  }, [filtered, term]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = list.filter((v) => new Date(v.entry_at) >= today).length;
  const groups: { key: Filter; label: string; hint: string }[] = [
    {
      key: "pending",
      label: "Waiting at the gate / expected",
      hint: "Not inside yet — approve or turn away.",
    },
    { key: "inside", label: "Inside now", hint: "Mark exit when they leave." },
    { key: "exited", label: "Completed", hint: "Left, denied or expired." },
  ];
  const fmt = (d: string) =>
    new Date(d).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

  const row = (v: V) => {
    const s = computeStatus(v);
    return (
      <li
        key={v.id}
        className={`relative grid gap-2 px-4 py-3 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r md:grid-cols-[1fr_12rem_auto] md:items-center md:gap-4 ${s === "pending" ? "before:bg-warning" : s === "inside" ? "before:bg-success" : "before:bg-transparent"}`}
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {s === "pending" && (
              <StatusChip tone="warning">
                {v.status === "approved"
                  ? tu("op.approved_not_in_yet")
                  : v.status === "expected"
                    ? tu("vs.st.expected")
                    : tu("op.waiting")}
              </StatusChip>
            )}
            {s === "inside" && <StatusChip tone="success">{tu("vs.st.inside")}</StatusChip>}
            {s === "exited" && (
              <StatusChip tone="muted">
                {v.exit_at && !["denied", "rejected"].includes(v.status ?? "")
                  ? tu("vs.st.exited")
                  : (v.status ?? tu("hd.st.closed"))}
              </StatusChip>
            )}
            {v.pre_approved && <StatusChip tone="info">{tu("op.pre_approved_pass")}</StatusChip>}
          </p>
          <p className="mt-0.5 truncate font-medium">{v.visitor_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {v.flat_number ? `House ${v.flat_number}` : tu("gd.noHouse")} · {v.purpose || tu("op.visit")}
            {v.vehicle_number && (
              <>
                {" "}
                · <span className="font-mono">{v.vehicle_number}</span>
              </>
            )}
          </p>
        </div>
        <p className="text-xs text-muted-foreground md:text-sm">
          In {fmt(v.entry_at)}
          {v.exit_at && (
            <>
              <br className="hidden md:block" />
              <span className="md:hidden"> · </span>{tu("op.out")} {fmt(v.exit_at)}
            </>
          )}
        </p>
        <div className="flex gap-2">
          {s === "pending" && (
            <>
              {v.status !== "awaiting" && (
                <Button
                  className="h-11 flex-1 rounded-xl md:flex-none"
                  onClick={() => approve(v.id)}
                >
                  <Check className="mr-1 h-4 w-4" />
                  {tu("op.check_in")}
                </Button>
              )}
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl md:flex-none"
                onClick={() => setDenyFor(v)}
              >
                <X className="mr-1 h-4 w-4" />
                {tu("op.turn_away")}
              </Button>
            </>
          )}
          {s === "inside" && (
            <Button
              variant="secondary"
              className="h-11 flex-1 rounded-xl md:flex-none"
              onClick={() => markExit(v.id)}
            >
              <LogOut className="mr-1 h-4 w-4" />
              {tu("op.mark_exit")}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={tu("nav.visitors")}
        description={tu("op.today_s_gate_activity_refreshes")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex items-center gap-2"
            aria-label={tu("op.check_in_by_pass_code")}
            onSubmit={(e) => { e.preventDefault(); void checkinByCode(); }}
          >
            <Label htmlFor="pass-code" className="sr-only">{tu("op.pass_code")}</Label>
            <Input
              id="pass-code"
              inputMode="numeric"
              maxLength={6}
              placeholder={tu("op.6_digit_code")}
              className="h-11 w-32 font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" variant="outline" className="h-11 rounded-xl" disabled={codeBusy || code.length !== 6}>
              {codeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("op.check_in")}
            </Button>
          </form>
          <Button variant="outline" className="h-11 rounded-xl" onClick={exportCsv} disabled={shown.length === 0}>
            <Download className="mr-2 h-4 w-4" /> {tu("common.download")}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 rounded-xl">
                <Plus className="mr-2 h-4 w-4" /> {tu("op.log_visitor")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tu("op.log_a_visitor")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="lv-name">{tu("op.visitor_name")}</Label>
                  <Input
                    id="lv-name"
                    className="h-11"
                    value={form.visitor_name}
                    onChange={(e) => setForm({ ...form, visitor_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="lv-phone">{tu("exp.phone")}</Label>
                    <Input
                      id="lv-phone"
                      inputMode="tel"
                      className="h-11"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lv-flat">{tu("gd.houseLabel")}</Label>
                    <Input
                      id="lv-flat"
                      className="h-11"
                      value={form.flat_number}
                      onChange={(e) => setForm({ ...form, flat_number: e.target.value })}
                      placeholder="A-101"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="lv-veh">{tu("op.vehicle_number")}</Label>
                  <Input
                    id="lv-veh"
                    className="h-11"
                    value={form.vehicle_number}
                    onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="lv-pur">{tu("gd.purpose")}</Label>
                  <Input
                    id="lv-pur"
                    className="h-11"
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                    placeholder={tu("op.delivery_guest")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={logVisitor} disabled={saving} className="h-11 rounded-xl">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("gd.logEntry")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {sl || loading ? (
        <ListSkeleton rows={5} />
      ) : loadFailed ? (
        <LoadError
          title={tu("op.we_couldn_t_load_the")}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      ) : (
        <>
          {societyId && <SecurityAdminPanel societyId={societyId} onChanged={() => void load()} />}
          <SummaryStrip
            items={[
              { label: "Waiting / expected", value: counts.pending },
              { label: "Inside now", value: counts.inside },
              { label: "Entries today", value: todayCount },
              { label: "Completed", value: counts.exited, hint: "Last 200 records" },
            ]}
          />
          <div className="mb-4 flex flex-col gap-3">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder={tu("op.name_house_vehicle_or_purpose")}
              label={tu("gd.searchVisitors")}
            />
            <SegmentedFilter
              label={tu("op.visitor_status")}
              value={filter}
              onChange={setFilter}
              options={[
                { key: "all", label: "All", count: list.length },
                { key: "pending", label: "Waiting", count: counts.pending },
                { key: "inside", label: "Inside", count: counts.inside },
                { key: "exited", label: "Completed", count: counts.exited },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <ListEmpty
              icon={UserCheck}
              title={
                term
                  ? tu("op.no_visitors_match")
                  : list.length
                    ? tu("op.nothing_in_this_view")
                    : tu("op.no_visitors_logged_yet")
              }
            >
              {list.length ? tu("op.try_another_filter_or_search") : tu("op.gate_entries_will_appear_here")}
            </ListEmpty>
          ) : (
            groups.map((g) => {
              const items = shown.filter((v) => computeStatus(v) === g.key);
              if (!items.length) return null;
              return (
                <section key={g.key} aria-label={g.label}>
                  <SectionLabel count={items.length}>{g.label}</SectionLabel>
                  <p className="-mt-1 mb-2 px-1 text-xs text-muted-foreground">{g.hint}</p>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                    {items.map(row)}
                  </ul>
                </section>
              );
            })
          )}
        </>
      )}

      <AlertDialog open={!!denyFor} onOpenChange={(o) => !o && setDenyFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tu("op.turn_away")} {denyFor?.visitor_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {tu("op.the_visit_will_be_marked")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{tu("op.keep_waiting")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                if (denyFor) void reject(denyFor.id);
                setDenyFor(null);
              }}
            >
              {tu("op.turn_away")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
