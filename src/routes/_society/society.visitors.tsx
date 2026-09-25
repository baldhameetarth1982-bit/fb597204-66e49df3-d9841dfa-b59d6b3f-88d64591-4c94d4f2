import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { Loader2, UserCheck, Plus, Check, X, LogOut } from "lucide-react";
import { StatusChip, SummaryStrip, ListSkeleton, LoadError, ListEmpty, SearchField, SegmentedFilter } from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { gateErrorMessage } from "@/lib/visitors";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/visitors")({
  head: () => ({ meta: [
    { title: "Visitor log — SociyoHub" },
    { name: "description", content: "Gate activity: waiting, inside and completed visits." },
    { property: "og:title", content: "Visitor log — SociyoHub" },
    { property: "og:description", content: "Gate activity: waiting, inside and completed visits." },
  ] }),
  component: () => (<FeatureGate feature="visitors"><SocietyVisitors /></FeatureGate>),
});

interface V {
  id: string; visitor_name: string; phone: string | null; vehicle_number: string | null;
  purpose: string | null; entry_at: string; exit_at: string | null; flat_number: string | null;
  status: string | null; pre_approved: boolean | null;
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
  const [form, setForm] = useState({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" });

  async function load() {
    if (!societyId) return;
    const { data, error } = await supabase
      .from("visitors")
      .select("id, visitor_name, phone, vehicle_number, purpose, entry_at, exit_at, flat_number, status, pre_approved")
      .eq("society_id", societyId)
      .order("entry_at", { ascending: false })
      .limit(200);
    if (error) { setLoadFailed(true); setLoading(false); return; }
    setLoadFailed(false);
    setList((data as V[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    if (societyId) {
      void load();
      const t = setInterval(load, 30000);
      return () => clearInterval(t);
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
    if (!user || !societyId || !form.visitor_name.trim()) return toast.error("Visitor name required");
    setSaving(true);
    const { error } = await supabase.from("visitors").insert({
      society_id: societyId,
      logged_by: user.id,
      visitor_name: form.visitor_name.trim(),
      phone: form.phone.trim() || null,
      vehicle_number: form.vehicle_number.trim() || null,
      purpose: form.purpose.trim() || null,
      flat_number: form.flat_number.trim() || null,
      status: "approved",
    });
    setSaving(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Visitor logged");
    setForm({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" });
    setOpen(false);
    void load();
  }

  async function approve(id: string) {
    const { error } = await supabase.from("visitors").update({ status: "approved" }).eq("id", id);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Approved");
    void load();
  }
  async function reject(id: string) {
    const { error } = await supabase.from("visitors").update({ status: "rejected", exit_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(gateErrorMessage(error));
    void load();
  }
  async function markExit(id: string) {
    const { error } = await supabase.from("visitors").update({ exit_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(gateErrorMessage(error));
    void load();
  }

  const [term, setTerm] = useState("");
  const shown = useMemo(() => {
    const s = term.trim().toLowerCase();
    return filtered.filter((v) => !s || `${v.visitor_name} ${v.flat_number ?? ""} ${v.vehicle_number ?? ""} ${v.purpose ?? ""}`.toLowerCase().includes(s));
  }, [filtered, term]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayCount = list.filter((v) => new Date(v.entry_at) >= today).length;
  const groups: { key: Filter; label: string; hint: string }[] = [
    { key: "pending", label: "Waiting at the gate / expected", hint: "Not inside yet — approve or turn away." },
    { key: "inside", label: "Inside now", hint: "Mark exit when they leave." },
    { key: "exited", label: "Completed", hint: "Left, denied or expired." },
  ];
  const fmt = (d: string) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const row = (v: V) => {
    const s = computeStatus(v);
    return (
      <li key={v.id} className={`relative grid gap-2 px-4 py-3 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r md:grid-cols-[1fr_12rem_auto] md:items-center md:gap-4 ${s === "pending" ? "before:bg-warning" : s === "inside" ? "before:bg-success" : "before:bg-transparent"}`}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {s === "pending" && <StatusChip tone="warning">{v.status === "approved" ? "Approved · not in yet" : v.status === "expected" ? "Expected" : "Waiting"}</StatusChip>}
            {s === "inside" && <StatusChip tone="success">Inside</StatusChip>}
            {s === "exited" && <StatusChip tone="muted">{v.exit_at && !["denied", "rejected"].includes(v.status ?? "") ? "Left" : (v.status ?? "Closed")}</StatusChip>}
            {v.pre_approved && <StatusChip tone="info">Pre-approved pass</StatusChip>}
          </p>
          <p className="mt-0.5 truncate font-medium">{v.visitor_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {v.flat_number ? `House ${v.flat_number}` : "No house"} · {v.purpose || "Visit"}
            {v.vehicle_number && <> · <span className="font-mono">{v.vehicle_number}</span></>}
          </p>
        </div>
        <p className="text-xs text-muted-foreground md:text-sm">In {fmt(v.entry_at)}{v.exit_at && <><br className="hidden md:block" /><span className="md:hidden"> · </span>Out {fmt(v.exit_at)}</>}</p>
        <div className="flex gap-2">
          {s === "pending" && (
            <>
              {v.status !== "approved" && <Button className="h-11 flex-1 rounded-xl md:flex-none" onClick={() => approve(v.id)}><Check className="mr-1 h-4 w-4" />Approve</Button>}
              <Button variant="outline" className="h-11 flex-1 rounded-xl md:flex-none" onClick={() => setDenyFor(v)}><X className="mr-1 h-4 w-4" />Turn away</Button>
            </>
          )}
          {s === "inside" && <Button variant="secondary" className="h-11 flex-1 rounded-xl md:flex-none" onClick={() => markExit(v.id)}><LogOut className="mr-1 h-4 w-4" />Mark exit</Button>}
        </div>
      </li>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title="Visitors"
        description="Today's gate activity · refreshes every 30 seconds"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="h-11 rounded-xl"><Plus className="mr-2 h-4 w-4" /> Log visitor</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Log a visitor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label htmlFor="lv-name">Visitor name</Label><Input id="lv-name" className="h-11" value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="lv-phone">Phone</Label><Input id="lv-phone" inputMode="tel" className="h-11" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                  <div><Label htmlFor="lv-flat">House</Label><Input id="lv-flat" className="h-11" value={form.flat_number} onChange={(e) => setForm({ ...form, flat_number: e.target.value })} placeholder="A-101" /></div>
                </div>
                <div><Label htmlFor="lv-veh">Vehicle number</Label><Input id="lv-veh" className="h-11" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
                <div><Label htmlFor="lv-pur">Purpose</Label><Input id="lv-pur" className="h-11" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Delivery, guest…" /></div>
              </div>
              <DialogFooter><Button onClick={logVisitor} disabled={saving} className="h-11 rounded-xl">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Log entry</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {sl || loading ? <ListSkeleton rows={5} />
        : loadFailed ? <LoadError title="We couldn't load the visitor log." onRetry={() => { setLoading(true); void load(); }} />
        : (
          <>
            <SummaryStrip items={[
              { label: "Waiting / expected", value: counts.pending },
              { label: "Inside now", value: counts.inside },
              { label: "Entries today", value: todayCount },
              { label: "Completed", value: counts.exited, hint: "Last 200 records" },
            ]} />
            <div className="mb-4 flex flex-col gap-3">
              <SearchField value={term} onChange={setTerm} placeholder="Name, house, vehicle or purpose" label="Search visitors" />
              <SegmentedFilter label="Visitor status" value={filter} onChange={setFilter} options={[
                { key: "all", label: "All", count: list.length },
                { key: "pending", label: "Waiting", count: counts.pending },
                { key: "inside", label: "Inside", count: counts.inside },
                { key: "exited", label: "Completed", count: counts.exited },
              ]} />
            </div>
            {shown.length === 0 ? (
              <ListEmpty icon={UserCheck} title={term ? "No visitors match" : list.length ? "Nothing in this view" : "No visitors logged yet"}>
                {list.length ? "Try another filter or search." : "Gate entries will appear here."}
              </ListEmpty>
            ) : groups.map((g) => {
              const items = shown.filter((v) => computeStatus(v) === g.key);
              if (!items.length) return null;
              return (
                <section key={g.key} aria-label={g.label}>
                  <SectionLabel count={items.length}>{g.label}</SectionLabel>
                  <p className="-mt-1 mb-2 px-1 text-xs text-muted-foreground">{g.hint}</p>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{items.map(row)}</ul>
                </section>
              );
            })}
          </>
        )}

      <AlertDialog open={!!denyFor} onOpenChange={(o) => !o && setDenyFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn away {denyFor?.visitor_name}?</AlertDialogTitle>
            <AlertDialogDescription>The visit will be marked rejected and closed. This can't be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep waiting</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => { if (denyFor) void reject(denyFor.id); setDenyFor(null); }}>Turn away</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
