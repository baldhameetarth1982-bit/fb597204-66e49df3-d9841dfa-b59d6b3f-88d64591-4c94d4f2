import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ParkingSquare, Zap, AlertTriangle, Download, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip, SummaryStrip, ListSkeleton, LoadError, ListEmpty, SegmentedFilter, SearchField } from "@/components/people/PeopleUI";
import { gateErrorMessage, fmtTime } from "@/lib/visitors";
import { allocationState, label, TEMP_PURPOSES, toCsv, VIOLATION_TYPES, violationLabel } from "./parking";
import { PhotoPicker, usePhotoQueue, useEvidenceUploader, ViolationEvidence, type Pending } from "./ViolationEvidence";
import { tu } from "@/lib/i18n";

const NONE = "__none";
const n = (v: string) => (v === NONE || v === "" ? null : v);
// Supabase RPC typings mark optional args as non-null; nulls are valid server-side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as any)(name, args) as Promise<{ data: any; error: { message: string } | null }>;

export interface Slot { id: string; label: string; slot_type: string; flat_id: string | null; vehicle_id: string | null; notes: string | null; block_id: string | null; floor: string | null; ev_capable: boolean; availability: string }
export interface Alloc { id: string; slot_id: string; kind: string; flat_id: string | null; vehicle_id: string | null; temp_purpose: string | null; starts_at: string; ends_at: string | null; reason: string | null; status: string; released_at: string | null; release_reason: string | null; created_at: string }
interface Flat { id: string; flat_number: string; block_id: string | null }
interface Veh { id: string; plate_number: string; flat_id: string | null }
interface Block { id: string; name: string }

export function useParkingData(societyId: string | null | undefined) {
  return useQuery({
    queryKey: ["parking", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const [s, a, f, v, b] = await Promise.all([
        supabase.from("parking_slots").select("id, label, slot_type, flat_id, vehicle_id, notes, block_id, floor, ev_capable, availability").eq("society_id", societyId!).eq("is_active", true).order("label"),
        supabase.from("parking_allocations").select("id, slot_id, kind, flat_id, vehicle_id, temp_purpose, starts_at, ends_at, reason, status, released_at, release_reason, created_at").eq("society_id", societyId!).order("created_at", { ascending: false }).limit(1000),
        supabase.from("flats").select("id, flat_number, block_id").eq("society_id", societyId!).order("flat_number").limit(2000),
        supabase.from("vehicles").select("id, plate_number, flat_id").eq("society_id", societyId!).eq("is_active", true).limit(2000),
        supabase.from("blocks").select("id, name").eq("society_id", societyId!).order("name"),
      ]);
      for (const r of [s, a, f, v, b]) if (r.error) throw r.error;
      return { slots: (s.data ?? []) as Slot[], allocs: (a.data ?? []) as Alloc[], flats: (f.data ?? []) as Flat[], vehicles: (v.data ?? []) as Veh[], blocks: (b.data ?? []) as Block[] };
    },
  });
}
type PData = NonNullable<ReturnType<typeof useParkingData>["data"]>;

function useNames(d: PData | undefined) {
  return useMemo(() => ({
    flat: new Map((d?.flats ?? []).map((f) => [f.id, f.flat_number])),
    plate: new Map((d?.vehicles ?? []).map((v) => [v.id, v.plate_number])),
    slot: new Map((d?.slots ?? []).map((s) => [s.id, s.label])),
    block: new Map((d?.blocks ?? []).map((b) => [b.id, b.name])),
  }), [d]);
}

function stateChip(st: string) {
  const tone = st === "active" ? "primary" : st === "upcoming" ? "info" : st === "expired" ? "warning" : "neutral";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <StatusChip tone={tone as any}><span className="capitalize">{st}</span></StatusChip>;
}

function HolderPicker({ d, flat, vehicle, onFlat, onVehicle, flatOptional }: { d: PData; flat: string; vehicle: string; onFlat: (v: string) => void; onVehicle: (v: string) => void; flatOptional?: boolean }) {
  const vehs = d.vehicles.filter((v) => flat === NONE || v.flat_id === flat);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label>{tu("gd.houseLabel")}</Label>
        <Select value={flat} onValueChange={(v) => { onFlat(v); onVehicle(NONE); }}>
          <SelectTrigger aria-label={tu("gd.houseLabel")} className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{flatOptional ? tu("gd.noHouse") : tu("op.pick_a_house")}</SelectItem>{d.flats.map((f) => <SelectItem key={f.id} value={f.id}>{f.flat_number}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>{tu("op.vehicle_optional")}</Label>
        <Select value={vehicle} onValueChange={onVehicle}>
          <SelectTrigger aria-label={tu("vs.vehicle")} className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{tu("op.any_vehicle_of_the_house")}</SelectItem>{vehs.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate_number}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* ================= Capacity ================= */
export function CapacityPanel({ d }: { d: PData | undefined }) {
  const [block, setBlock] = useState(NONE);
  const [type, setType] = useState(NONE);
  const [floor, setFloor] = useState("");
  const cap = useQuery({
    queryKey: ["parking-capacity", block, type, floor.trim().toUpperCase()],
    queryFn: async () => {
      const { data, error } = await rpc("admin_parking_capacity", { _block_id: n(block), _floor: floor.trim() || null, _slot_type: n(type) });
      if (error) throw error;
      return data as Record<string, number>;
    },
  });
  const c = cap.data;
  const usable = c ? c.total - c.unavailable - c.visitor_total : 0;
  const util = c && usable > 0 ? Math.round(((c.occupied + c.temporary) / usable) * 100) : null;
  const v = (k: string) => (cap.isLoading || cap.isError || !c ? "—" : c[k]);
  return (
    <section aria-labelledby="cap-h" className="mb-6">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <h2 id="cap-h" className="mr-auto text-sm font-semibold">{tu("op.capacity_right_now")}</h2>
        <Select value={block} onValueChange={setBlock}><SelectTrigger aria-label={tu("op.filter_by_block")} className="h-11 w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{tu("mnt.allBlocks")}</SelectItem>{(d?.blocks ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select>
        <Input aria-label={tu("op.filter_by_floor")} placeholder={tu("op.floor")} value={floor} onChange={(e) => setFloor(e.target.value)} className="h-11 w-24" maxLength={20} />
        <Select value={type} onValueChange={setType}><SelectTrigger aria-label={tu("op.filter_by_slot_type")} className="h-11 w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{tu("op.all_types")}</SelectItem>{["car", "bike", "visitor", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select>
      </div>
      {cap.isError ? <LoadError title={gateErrorMessage(cap.error)} onRetry={() => void cap.refetch()} /> : (
        <>
          <SummaryStrip items={[
            { label: "Total slots", value: v("total") },
            { label: "Assigned", value: v("occupied") },
            { label: "Temporarily used", value: v("temporary") },
            { label: "Available", value: v("available") },
          ]} />
          <SummaryStrip items={[
            { label: "Reserved", value: v("reserved") },
            { label: "Unavailable", value: v("unavailable") },
            { label: "Visitor slots in use", value: c ? `${c.visitor_in_use} / ${c.visitor_total}` : "—" },
            { label: "EV-capable · Utilisation", value: c ? `${c.ev_capable} · ${util === null ? "—" : util + "%"}` : "—" },
          ]} />
        </>
      )}
    </section>
  );
}

/* ================= Slots + permanent lifecycle ================= */
const EMPTY_SLOT = { id: null as string | null, label: "", slot_type: "car", block_id: NONE, floor: "", ev_capable: false, availability: "open", notes: "" };

export function SlotsTab({ d, onAdd }: { d: PData; onAdd: number }) {
  const qc = useQueryClient();
  const names = useNames(d);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "assigned" | "free" | "visitor">("all");
  const [form, setForm] = useState(EMPTY_SLOT);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holder, setHolder] = useState({ flat: NONE, vehicle: NONE, reason: "" });
  const [rel, setRel] = useState({ reason: "", date: "" });
  const [lastAdd, setLastAdd] = useState(onAdd);
  if (onAdd !== lastAdd) { setLastAdd(onAdd); setForm(EMPTY_SLOT); setOpen(true); }

  const active = useMemo(() => new Map(d.allocs.filter((a) => a.status === "active" && a.kind === "permanent").map((a) => [a.slot_id, a])), [d.allocs]);
  const tempNow = useMemo(() => new Set(d.allocs.filter((a) => a.kind === "temporary" && allocationState(a) === "active").map((a) => a.slot_id)), [d.allocs]);
  const shown = d.slots.filter((s) => {
    const t = q.trim().toLowerCase();
    if (t && ![s.label, names.flat.get(s.flat_id ?? ""), names.plate.get(s.vehicle_id ?? ""), s.floor].some((x) => x?.toLowerCase().includes(t))) return false;
    if (view === "visitor") return s.slot_type === "visitor";
    if (view === "assigned") return active.has(s.id);
    if (view === "free") return s.slot_type !== "visitor" && !active.has(s.id) && !tempNow.has(s.id) && s.availability === "open";
    return true;
  });
  const cur = form.id ? active.get(form.id) : undefined;
  const history = form.id ? d.allocs.filter((a) => a.slot_id === form.id) : [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["parking"] }); qc.invalidateQueries({ queryKey: ["parking-capacity"] }); };

  async function run(fn: () => Promise<{ error: { message: string } | null }>, ok: string, close = false) {
    if (busy) return;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(ok);
    refresh();
    if (close) setOpen(false);
  }

  const saveSlot = (e: React.FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await rpc("admin_parking_slot_save", { _id: form.id, _label: form.label, _slot_type: form.slot_type, _block_id: n(form.block_id), _floor: form.floor || null, _ev_capable: form.ev_capable, _availability: form.availability, _notes: form.notes });
    if (!r.error && !form.id) setForm((f) => ({ ...f, id: r.data as string }));
    return r;
  }, form.id ? "Slot updated" : "Slot added"); };

  const assign = (realloc: boolean) => {
    if (n(holder.flat) === null && n(holder.vehicle) === null) return toast.error(tu("op.pick_a_house_or_a"));
    if (realloc && !holder.reason.trim()) return toast.error(tu("op.write_why_the_slot_is"));
    void run(() => rpc(realloc ? "admin_parking_reallocate" : "admin_parking_assign", { _slot_id: form.id, _flat_id: n(holder.flat), _vehicle_id: n(holder.vehicle), _reason: holder.reason || null }),
      realloc ? "Slot reallocated" : "Slot assigned").then(() => setHolder({ flat: NONE, vehicle: NONE, reason: "" }));
  };
  const release = () => {
    if (!cur) return;
    if (!rel.reason.trim()) return toast.error(tu("op.write_why_the_slot_is_2"));
    void run(() => rpc("admin_parking_release", { _allocation_id: cur.id, _reason: rel.reason, _effective_at: rel.date ? new Date(rel.date + "T12:00:00").toISOString() : null }), "Slot released")
      .then(() => setRel({ reason: "", date: "" }));
  };
  const archive = () => void run(() => rpc("admin_parking_archive", { _id: form.id }), "Slot removed", true);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField label={tu("op.search_parking")} placeholder={tu("op.slot_house_plate_or_floor")} value={q} onChange={setQ} />
        <SegmentedFilter label={tu("op.slot_status")} value={view} onChange={setView} options={[
          { key: "all", label: "All" }, { key: "assigned", label: "Assigned" }, { key: "free", label: "Free" }, { key: "visitor", label: "Visitor" },
        ]} />
      </div>
      {d.slots.length === 0 ? (
        <ListEmpty icon={ParkingSquare} title={tu("op.no_parking_slots_yet")}>{tu("op.add_your_first_slot_then")}</ListEmpty>
      ) : shown.length === 0 ? (
        <ListEmpty icon={ParkingSquare} title={tu("op.no_matching_slots")}>{tu("op.try_another_search_or_filter")}</ListEmpty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label={tu("op.parking_slots")}>
          {shown.map((s) => {
            const a = active.get(s.id);
            return (
              <li key={s.id}>
                <button type="button" onClick={() => { setForm({ id: s.id, label: s.label, slot_type: s.slot_type, block_id: s.block_id ?? NONE, floor: s.floor ?? "", ev_capable: s.ev_capable, availability: s.availability, notes: s.notes ?? "" }); setHolder({ flat: NONE, vehicle: NONE, reason: "" }); setOpen(true); }}
                  aria-label={`Open slot ${s.label}`} className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 min-w-11 place-items-center rounded-xl border border-border bg-background px-2 font-mono text-sm font-semibold">{s.label}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-medium capitalize">{s.slot_type} {tu("op.slot")} {s.ev_capable && <Zap className="h-3.5 w-3.5 text-primary" aria-label={tu("op.ev_capable")} />}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[s.block_id && names.block.get(s.block_id), s.floor && `Floor ${s.floor}`, s.notes].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                  </span>
                  <span className="text-sm">{a?.flat_id ? `House ${names.flat.get(a.flat_id) ?? "—"}` : <span className="text-muted-foreground">{s.slot_type === "visitor" ? tu("op.for_visitors") : tu("op.not_assigned")}</span>}</span>
                  <span className="font-mono text-sm">{a?.vehicle_id ? names.plate.get(a.vehicle_id) ?? "—" : <span className="font-sans text-muted-foreground">{a ? tu("op.any_vehicle_of_the_house") : "—"}</span>}</span>
                  <span className="flex flex-wrap gap-1">
                    {s.availability === "unavailable" ? <StatusChip tone="warning">{tu("hd.unavailable")}</StatusChip>
                      : a ? <StatusChip tone="primary">{tu("op.assigned")}</StatusChip>
                      : tempNow.has(s.id) ? <StatusChip tone="warning">{tu("op.temporary")}</StatusChip>
                      : s.availability === "reserved" ? <StatusChip tone="info">{tu("op.reserved")}</StatusChip>
                      : <StatusChip tone="success">{tu("cm.free")}</StatusChip>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{form.id ? `Slot ${form.label}` : tu("op.add_slot")}</SheetTitle></SheetHeader>
          <form onSubmit={saveSlot} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="p-label">{tu("op.slot_name")}</Label><Input id="p-label" className="h-11" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value.toUpperCase() })} placeholder="P-12" maxLength={20} required /></div>
              <div><Label>{tu("cm.type")}</Label>
                <Select value={form.slot_type} onValueChange={(v) => setForm({ ...form, slot_type: v })}>
                  <SelectTrigger aria-label={tu("cm.type")} className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{["car", "bike", "visitor", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{tu("mnt.block")}</Label>
                <Select value={form.block_id} onValueChange={(v) => setForm({ ...form, block_id: v })}>
                  <SelectTrigger aria-label={tu("mnt.block")} className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>{tu("op.no_block")}</SelectItem>{d.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="p-floor">{tu("op.floor_level")}</Label><Input id="p-floor" className="h-11" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} maxLength={20} placeholder="B1" /></div>
              <div><Label>{tu("common.status")}</Label>
                <Select value={form.availability} onValueChange={(v) => setForm({ ...form, availability: v })}>
                  <SelectTrigger aria-label={tu("common.status")} className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="open">{tu("common.open")}</SelectItem><SelectItem value="reserved">{tu("op.reserved")}</SelectItem><SelectItem value="unavailable">{tu("hd.unavailable")}</SelectItem></SelectContent>
                </Select>
              </div>
              <label className="flex min-h-11 items-center justify-between gap-2 self-end rounded-xl border border-border px-3 text-sm">{tu("op.ev_capable")}<Switch checked={form.ev_capable} onCheckedChange={(v) => setForm({ ...form, ev_capable: v })} aria-label={tu("op.ev_capable")} /></label>
            </div>
            <div><Label htmlFor="p-notes">{tu("exp.notes")}</Label><Input id="p-notes" className="h-11" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={200} placeholder={tu("op.e_g_near_lift")} /></div>
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("op.save_slot_details")}</Button>
          </form>

          {form.id && form.slot_type !== "visitor" && (
            <section className="space-y-3 border-t border-border py-4" aria-label={tu("op.assignment")}>
              <h3 className="text-sm font-semibold">{tu("op.assignment")}</h3>
              {cur ? (
                <div className="rounded-xl border border-border p-3 text-sm">
                  <p>{tu("gd.houseLabel")} <b>{cur.flat_id ? names.flat.get(cur.flat_id) : "—"}</b>{cur.vehicle_id && <> · <span className="font-mono">{names.plate.get(cur.vehicle_id)}</span></>}</p>
                  <p className="text-xs text-muted-foreground">{tu("op.since")} {new Date(cur.starts_at).toLocaleDateString()}{cur.reason ? ` · ${cur.reason}` : ""}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <Input aria-label={tu("op.release_reason")} placeholder={tu("op.reason_for_release")} value={rel.reason} onChange={(e) => setRel({ ...rel, reason: e.target.value })} maxLength={300} className="h-11" />
                    <Input aria-label={tu("op.effective_date")} type="date" value={rel.date} onChange={(e) => setRel({ ...rel, date: e.target.value })} className="h-11" />
                    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={release}>{tu("op.release")}</Button>
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">{tu("op.not_assigned_only_homes_with")}</p>}
              <HolderPicker d={d} flat={holder.flat} vehicle={holder.vehicle} onFlat={(v) => setHolder((h) => ({ ...h, flat: v }))} onVehicle={(v) => setHolder((h) => ({ ...h, vehicle: v }))} />
              <Input aria-label={tu("op.assignment_note")} placeholder={cur ? tu("op.reason_for_reallocation_required") : tu("op.note_optional")} value={holder.reason} onChange={(e) => setHolder({ ...holder, reason: e.target.value })} maxLength={300} className="h-11" />
              <Button type="button" className="min-h-11 w-full rounded-xl" disabled={busy} onClick={() => assign(!!cur)}>{cur ? tu("op.reallocate_to_this_home") : tu("op.assign_slot")}</Button>
            </section>
          )}

          {form.id && (
            <section className="space-y-2 border-t border-border py-4" aria-label={tu("op.slot_history")}>
              <h3 className="text-sm font-semibold">{tu("billingTabs.history")}</h3>
              {history.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_allocations_yet")}</p> : (
                <ul className="space-y-2">{history.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <span><span className="capitalize">{a.kind}</span> · {a.flat_id ? `House ${names.flat.get(a.flat_id) ?? "—"}` : tu("gd.noHouse")}{a.vehicle_id ? ` · ${names.plate.get(a.vehicle_id) ?? ""}` : ""}
                      <span className="block text-xs text-muted-foreground">{new Date(a.starts_at).toLocaleString()} → {a.released_at ? new Date(a.released_at).toLocaleString() : a.ends_at ? new Date(a.ends_at).toLocaleString() : tu("op.now")}{a.release_reason ? ` · ${a.release_reason}` : ""}</span></span>
                    {stateChip(allocationState(a))}
                  </li>))}</ul>
              )}
              <Button type="button" variant="ghost" className="min-h-11 w-full text-destructive" disabled={busy} onClick={archive}>{tu("op.remove_slot")}</Button>
            </section>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ================= Temporary ================= */
function localInput(d: Date) { const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

export function TemporaryTab({ d }: { d: PData }) {
  const qc = useQueryClient();
  const names = useNames(d);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({ slot: NONE, flat: NONE, vehicle: NONE, purpose: "guest", start: localInput(new Date()), end: localInput(new Date(Date.now() + 24 * 3600e3)), reason: "" }));
  const temps = d.allocs.filter((a) => a.kind === "temporary");
  const live = temps.filter((a) => ["active", "upcoming"].includes(allocationState(a)));
  const past = temps.filter((a) => !["active", "upcoming"].includes(allocationState(a))).slice(0, 50);
  const slots = d.slots.filter((s) => s.slot_type !== "visitor" && s.availability !== "unavailable");

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (f.slot === NONE) return toast.error(tu("op.pick_a_slot"));
    if (!f.reason.trim()) return toast.error(tu("op.write_a_reason"));
    setBusy(true);
    const { error } = await rpc("admin_parking_temp_allocate", { _slot_id: f.slot, _flat_id: n(f.flat), _vehicle_id: n(f.vehicle), _purpose: f.purpose, _starts_at: new Date(f.start).toISOString(), _ends_at: new Date(f.end).toISOString(), _reason: f.reason });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("op.temporary_parking_issued"));
    setF((x) => ({ ...x, reason: "", flat: NONE, vehicle: NONE }));
    qc.invalidateQueries({ queryKey: ["parking"] }); qc.invalidateQueries({ queryKey: ["parking-capacity"] });
  }
  async function cancel(id: string) {
    const reason = window.prompt("Why cancel this temporary parking?");
    if (!reason?.trim()) return;
    const { error } = await rpc("admin_parking_release", { _allocation_id: id, _reason: reason, _effective_at: null });
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("rbills.cancelled"));
    qc.invalidateQueries({ queryKey: ["parking"] }); qc.invalidateQueries({ queryKey: ["parking-capacity"] });
  }
  const row = (a: Alloc, actions: boolean) => (
    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <span className="min-w-0"><b className="font-mono">{names.slot.get(a.slot_id) ?? tu("op.removed_slot")}</b> · {label(TEMP_PURPOSES, a.temp_purpose)} · {a.flat_id ? `House ${names.flat.get(a.flat_id)}` : tu("gd.noHouse")}{a.vehicle_id ? ` · ${names.plate.get(a.vehicle_id)}` : ""}
        <span className="block text-xs text-muted-foreground">{fmtTime(a.starts_at)} → {fmtTime(a.ends_at)}{a.reason ? ` · ${a.reason}` : ""}</span></span>
      <span className="flex items-center gap-2">{stateChip(allocationState(a))}{actions && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => void cancel(a.id)}>{tu("common.cancel")}</Button>}</span>
    </li>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <form onSubmit={issue} className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label={tu("op.issue_temporary_parking")}>
        <h3 className="text-sm font-semibold">{tu("op.issue_temporary_parking")}</h3>
        <div><Label>{tu("vh.slot")}</Label>
          <Select value={f.slot} onValueChange={(v) => setF({ ...f, slot: v })}><SelectTrigger aria-label={tu("vh.slot")} className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{tu("op.pick_a_slot_2")}</SelectItem>{slots.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>{tu("op.why")}</Label>
          <Select value={f.purpose} onValueChange={(v) => setF({ ...f, purpose: v })}><SelectTrigger aria-label={tu("gd.purpose")} className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{TEMP_PURPOSES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
        </div>
        <HolderPicker d={d} flat={f.flat} vehicle={f.vehicle} onFlat={(v) => setF((x) => ({ ...x, flat: v }))} onVehicle={(v) => setF((x) => ({ ...x, vehicle: v }))} flatOptional={f.purpose === "maintenance"} />
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="t-s">{tu("op.starts_2")}</Label><Input id="t-s" type="datetime-local" className="h-11" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div><Label htmlFor="t-e">{tu("op.ends")}</Label><Input id="t-e" type="datetime-local" className="h-11" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        </div>
        <div><Label htmlFor="t-r">{tu("el.a.reasonLbl")}</Label><Input id="t-r" className="h-11" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} placeholder={tu("op.e_g_car_in_for")} /></div>
        <p className="text-xs text-muted-foreground">{tu("op.up_to_30_days_it")}</p>
        <Button type="submit" className="min-h-11 w-full rounded-xl" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("op.issue")}</Button>
      </form>
      <div className="space-y-4">
        <section aria-label={tu("op.active_temporary_parking")}>
          <h3 className="mb-2 text-sm font-semibold">{tu("op.active_and_upcoming")}</h3>
          {live.length === 0 ? <ListEmpty icon={Clock} title={tu("op.no_temporary_parking_right_now")} /> : <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{live.map((a) => row(a, true))}</ul>}
        </section>
        <section aria-label={tu("op.past_temporary_parking")}>
          <h3 className="mb-2 text-sm font-semibold">{tu("op.ended")}</h3>
          {past.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.nothing_has_ended_yet")}</p> : <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{past.map((a) => row(a, false))}</ul>}
        </section>
      </div>
    </div>
  );
}

/* ================= Violations ================= */
interface Viol { id: string; violation_type: string; slot_id: string | null; vehicle_id: string | null; flat_id: string | null; plate_text: string | null; location: string | null; description: string | null; occurred_at: string; status: string; resolution_note: string | null }

export function ViolationReportForm({ slots, onDone }: { slots: { id: string; label: string }[]; onDone?: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ type: "wrong_slot", slot: NONE, plate: "", location: "", description: "" });
  const [busy, setBusy] = useState(false);
  // Set once the violation is saved but some photos failed: the form stays put for retry.
  const [savedId, setSavedId] = useState<string | null>(null);
  const photos = usePhotoQueue();
  const runUpload = useEvidenceUploader();
  function finish() {
    setF({ type: "wrong_slot", slot: NONE, plate: "", location: "", description: "" });
    photos.clear(); setSavedId(null); onDone?.();
  }
  async function uploadFor(id: string, only?: Pending[]) {
    const failed = await runUpload(id, photos, only);
    if (failed) { setSavedId(id); toast.error(t("pk.photosFailed", { count: failed })); return; }
    toast.success(t("pk.okPhotos"));
    finish();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (savedId) { setBusy(true); await uploadFor(savedId); setBusy(false); return; }
    if (f.slot === NONE && f.plate.replace(/[^a-z0-9]/gi, "").length < 3) return toast.error(t("pk.needSlot"));
    setBusy(true);
    const { data, error } = await rpc("parking_violation_report", { _type: f.type, _slot_id: n(f.slot), _plate: f.plate || null, _location: f.location || null, _description: f.description || null, _occurred_at: null });
    if (error) { setBusy(false); return toast.error(gateErrorMessage(error)); }
    if (photos.items.length && typeof data === "string") { await uploadFor(data); setBusy(false); return; }
    setBusy(false);
    toast.success(t("pk.ok"));
    finish();
  }
  const locked = !!savedId;
  const pendingLeft = photos.items.some((p) => p.state !== "done");
  return (
    <form onSubmit={submit} className="space-y-3" aria-label={t("pk.report")}>
      <fieldset disabled={locked} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>{t("cm.type")}</Label>
          <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger aria-label={t("pk.violationType")} className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{VIOLATION_TYPES.map(([k]) => <SelectItem key={k} value={k}>{violationLabel(k)}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>{t("vh.slot")}</Label>
          <Select value={f.slot} onValueChange={(v) => setF({ ...f, slot: v })}><SelectTrigger aria-label={t("vh.slot")} className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("pk.notInSlot")}</SelectItem>{slots.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label htmlFor="v-plate">{t("gd.plate")}</Label><Input id="v-plate" className="h-11 font-mono uppercase" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} maxLength={15} placeholder="GJ01AB1234" /></div>
        <div><Label htmlFor="v-loc">{t("pk.location")}</Label><Input id="v-loc" className="h-11" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={120} placeholder={t("pk.locPh")} /></div>
      </div>
      <div><Label htmlFor="v-desc">{t("pk.what")}</Label><Textarea id="v-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} rows={2} /></div>
      </fieldset>
      <div><Label>{t("pk.photos")}</Label><PhotoPicker q={photos} disabled={busy} onRetry={savedId ? (p) => { setBusy(true); void uploadFor(savedId, [p]).finally(() => setBusy(false)); } : undefined} /></div>
      {locked && <p role="status" className="text-xs">{t("pk.saved")} {pendingLeft ? t("pk.retryHint") : ""}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1 rounded-xl" disabled={busy || (locked && !pendingLeft)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? t("pk.retryPhotos") : t("pk.record")}</Button>
        {locked && <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={finish}>{t("pk.finish")}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{t("pk.noCharge")}</p>
    </form>
  );
}

export function ViolationsTab({ d, societyId }: { d: PData; societyId: string }) {
  const qc = useQueryClient();
  const names = useNames(d);
  const [view, setView] = useState<"open" | "closed" | "all">("open");
  const list = useQuery({
    queryKey: ["parking-violations", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("parking_violations").select("id, violation_type, slot_id, vehicle_id, flat_id, plate_text, location, description, occurred_at, status, resolution_note").eq("society_id", societyId).order("occurred_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Viol[];
    },
  });
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const v of list.data ?? []) if (v.plate_text) m.set(v.plate_text, (m.get(v.plate_text) ?? 0) + 1); return m; }, [list.data]);
  const rows = (list.data ?? []).filter((v) => view === "all" ? true : view === "open" ? ["open", "warned"].includes(v.status) : ["resolved", "dismissed"].includes(v.status));
  async function act(id: string, status: string) {
    const note = window.prompt(status === "warned" ? "Warning message to the home" : "Resolution note");
    if (!note?.trim()) return;
    const { error } = await rpc("admin_parking_violation_update", { _id: id, _status: status, _note: note });
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(tu("hd.st.updated"));
    qc.invalidateQueries({ queryKey: ["parking-violations"] });
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="rounded-2xl border border-border bg-card p-4"><h3 className="mb-3 text-sm font-semibold">{tu("op.report_a_violation")}</h3>
        <ViolationReportForm slots={d.slots} onDone={() => qc.invalidateQueries({ queryKey: ["parking-violations"] })} /></div>
      <div>
        <div className="mb-3"><SegmentedFilter label={tu("op.violation_status")} value={view} onChange={setView} options={[{ key: "open", label: "Open" }, { key: "closed", label: "Closed" }, { key: "all", label: "All" }]} /></div>
        {list.isLoading ? <ListSkeleton rows={3} /> : list.isError ? <LoadError title={gateErrorMessage(list.error)} onRetry={() => void list.refetch()} />
          : rows.length === 0 ? <ListEmpty icon={AlertTriangle} title={tu("op.no_violations_here")} /> : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card" aria-label={tu("op.parking_violations")}>
            {rows.map((v) => (
              <li key={v.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{label(VIOLATION_TYPES, v.violation_type)}</b>
                  <span className="flex gap-1">
                    {v.plate_text && (counts.get(v.plate_text) ?? 0) > 1 && <StatusChip tone="warning">{tu("op.repeat")}{counts.get(v.plate_text)}</StatusChip>}
                    <StatusChip tone={v.status === "open" ? "warning" : v.status === "warned" ? "warning" : "neutral"}><span className="capitalize">{v.status}</span></StatusChip>
                  </span>
                </div>
                <p className="text-muted-foreground">{[v.plate_text && <span key="p" className="font-mono">{v.plate_text}</span>, v.slot_id && `Slot ${names.slot.get(v.slot_id) ?? ""}`, v.flat_id && `House ${names.flat.get(v.flat_id) ?? ""}`, v.location, fmtTime(v.occurred_at)].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>
                {v.description && <p>{v.description}</p>}
                {v.resolution_note && <p className="text-xs text-muted-foreground">{tu("op.committee")} {v.resolution_note}</p>}
                <ViolationEvidence violationId={v.id} canAdd={["open", "warned"].includes(v.status)} canRemove />
                {["open", "warned"].includes(v.status) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {v.status === "open" && <Button size="sm" variant="outline" className="min-h-11" onClick={() => void act(v.id, "warned")}>{tu("op.warn")}</Button>}
                    <Button size="sm" variant="outline" className="min-h-11" onClick={() => void act(v.id, "resolved")}>{tu("op.resolve")}</Button>
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={() => void act(v.id, "dismissed")}>{tu("go.dismiss")}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ================= EV ================= */
interface Charger { id: string; name: string; slot_id: string | null; connector: string | null; rated_kw: number | null; provider: string; status: string }
interface Sess { id: string; charger_id: string; vehicle_id: string; started_at: string; ended_at: string | null; energy_kwh: number | null; status: string }

export function EvTab({ d, societyId }: { d: PData; societyId: string }) {
  const qc = useQueryClient();
  const names = useNames(d);
  const [edit, setEdit] = useState<null | { id: string | null; name: string; slot: string; connector: string; kw: string; provider: string; status: string }>(null);
  const [busy, setBusy] = useState(false);
  const ev = useQuery({
    queryKey: ["ev", societyId],
    queryFn: async () => {
      const [c, s] = await Promise.all([
        supabase.from("ev_chargers").select("id, name, slot_id, connector, rated_kw, provider, status").eq("society_id", societyId).eq("is_active", true).order("name"),
        supabase.from("ev_charging_sessions").select("id, charger_id, vehicle_id, started_at, ended_at, energy_kwh, status").eq("society_id", societyId).order("started_at", { ascending: false }).limit(200),
      ]);
      if (c.error) throw c.error; if (s.error) throw s.error;
      return { chargers: (c.data ?? []) as Charger[], sessions: (s.data ?? []) as Sess[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ev"] });
  const evSlots = d.slots.filter((s) => s.ev_capable);
  async function call(name: string, args: Record<string, unknown>, ok: string) {
    if (busy) return false;
    setBusy(true);
    const { error } = await rpc(name, args);
    setBusy(false);
    if (error) { toast.error(gateErrorMessage(error)); return false; }
    toast.success(ok); refresh(); return true;
  }
  async function start(c: Charger) { const plate = window.prompt("Number plate of the vehicle to charge"); if (plate?.trim()) await call("ev_session_start", { _charger_id: c.id, _plate: plate }, "Charging session started"); }
  async function end(s: Sess) {
    const raw = window.prompt("Energy delivered in kWh, read from the charger's own meter. Leave empty if it has no meter.", "");
    if (raw === null) return;
    const kwh = raw.trim() === "" ? null : Number(raw);
    if (kwh !== null && (!Number.isFinite(kwh) || kwh < 0)) return toast.error(tu("op.enter_a_number_or_leave"));
    await call("ev_session_end", { _session_id: s.id, _energy_kwh: kwh, _note: null }, "Session ended");
  }
  if (ev.isLoading) return <ListSkeleton rows={3} />;
  if (ev.isError) return <LoadError title={gateErrorMessage(ev.error)} onRetry={() => void ev.refetch()} />;
  const active = new Map(ev.data!.sessions.filter((s) => s.status === "active").map((s) => [s.charger_id, s]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">{tu("op.no_charger_provider_is_connected")}</p>
        <Button className="min-h-11 rounded-xl" onClick={() => setEdit({ id: null, name: "", slot: NONE, connector: "", kw: "", provider: "manual", status: "available" })}>{tu("op.add_charger")}</Button>
      </div>
      {ev.data!.chargers.length === 0 ? <ListEmpty icon={Zap} title={tu("op.no_ev_chargers_yet")}>{tu("op.mark_a_slot_as_ev")}</ListEmpty> : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label={tu("op.ev_chargers")}>
          {ev.data!.chargers.map((c) => { const s = active.get(c.id); const usable = c.status === "available" && c.provider !== "unconfigured"; return (
            <li key={c.id} className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div><b>{c.name}</b><p className="text-xs text-muted-foreground">{[c.slot_id ? `Slot ${names.slot.get(c.slot_id) ?? ""}` : "No slot", c.connector, c.rated_kw ? `${c.rated_kw} kW rated` : null].filter(Boolean).join(" · ")}</p></div>
                {c.provider === "unconfigured" ? <StatusChip tone="neutral">{tu("op.not_set_up")}</StatusChip> : s ? <StatusChip tone="primary">{tu("op.charging")}</StatusChip> : c.status === "available" ? <StatusChip tone="success">{tu("prof.available")}</StatusChip> : <StatusChip tone="warning"><span className="capitalize">{c.status}</span></StatusChip>}
              </div>
              {s && <p>{tu("vs.vehicle")} <span className="font-mono">{names.plate.get(s.vehicle_id) ?? "—"}</span> {tu("op.since_2")} {fmtTime(s.started_at)}</p>}
              <div className="flex flex-wrap gap-2">
                {s ? <Button size="sm" className="min-h-11" disabled={busy} onClick={() => void end(s)}>{tu("op.end_session")}</Button>
                  : <Button size="sm" className="min-h-11" disabled={busy || !usable} onClick={() => void start(c)}>{usable ? tu("op.start_session") : tu("hd.unavailable")}</Button>}
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => setEdit({ id: c.id, name: c.name, slot: c.slot_id ?? NONE, connector: c.connector ?? "", kw: c.rated_kw ? String(c.rated_kw) : "", provider: c.provider, status: c.status })}>{tu("common.edit")}</Button>
              </div>
            </li>); })}
        </ul>
      )}
      <section aria-label={tu("op.charging_history")}>
        <h3 className="mb-2 text-sm font-semibold">{tu("op.charging_history")}</h3>
        {ev.data!.sessions.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_sessions_yet")}</p> : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{ev.data!.sessions.slice(0, 50).map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
              <span><span className="font-mono">{names.plate.get(s.vehicle_id) ?? "—"}</span> · {ev.data!.chargers.find((c) => c.id === s.charger_id)?.name ?? tu("op.retired_charger")}<span className="block text-xs text-muted-foreground">{fmtTime(s.started_at)} → {s.ended_at ? fmtTime(s.ended_at) : tu("op.now")}</span></span>
              <span className="text-xs text-muted-foreground">{s.energy_kwh !== null ? `${s.energy_kwh} kWh (meter)` : s.status === "active" ? tu("hd.st.in_progress") : tu("op.no_reading")}</span>
            </li>))}</ul>
        )}
      </section>
      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{edit?.id ? tu("op.edit_charger") : tu("op.add_charger")}</SheetTitle></SheetHeader>
          {edit && (
            <form className="space-y-3 py-4" onSubmit={async (e) => { e.preventDefault();
              const kw = edit.kw.trim() ? Number(edit.kw) : null;
              if (kw !== null && !(kw > 0 && kw <= 400)) return toast.error(tu("op.rated_power_must_be_between"));
              if (await call("admin_ev_charger_save", { _id: edit.id, _name: edit.name, _slot_id: n(edit.slot), _connector: edit.connector || null, _rated_kw: kw, _provider: edit.provider, _status: edit.status }, "Charger saved")) setEdit(null); }}>
              <div><Label htmlFor="c-name">{tu("vs.nameReq")}</Label><Input id="c-name" className="h-11" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} required /></div>
              <div><Label>{tu("op.ev_capable_slot")}</Label>
                <Select value={edit.slot} onValueChange={(v) => setEdit({ ...edit, slot: v })}><SelectTrigger aria-label={tu("vh.slot")} className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>{tu("op.no_slot")}</SelectItem>{evSlots.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select>
                {evSlots.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{tu("op.no_slot_is_marked_ev")}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="c-con">{tu("op.connector")}</Label><Input id="c-con" className="h-11" value={edit.connector} onChange={(e) => setEdit({ ...edit, connector: e.target.value })} maxLength={40} placeholder={tu("op.type_2")} /></div>
                <div><Label htmlFor="c-kw">{tu("op.rated_kw")}</Label><Input id="c-kw" inputMode="decimal" className="h-11" value={edit.kw} onChange={(e) => setEdit({ ...edit, kw: e.target.value })} placeholder="7.4" /></div>
                <div><Label>{tu("op.control")}</Label>
                  <Select value={edit.provider} onValueChange={(v) => setEdit({ ...edit, provider: v })}><SelectTrigger aria-label={tu("op.control")} className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="manual">{tu("op.manual_staff_start_stop")}</SelectItem><SelectItem value="unconfigured">{tu("op.not_set_up_yet")}</SelectItem></SelectContent></Select>
                </div>
                <div><Label>{tu("common.status")}</Label>
                  <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}><SelectTrigger aria-label={tu("common.status")} className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="available">{tu("prof.available")}</SelectItem><SelectItem value="offline">{tu("op.offline")}</SelectItem><SelectItem value="disabled">{tu("op.disabled")}</SelectItem></SelectContent></Select>
                </div>
              </div>
              <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy}>{tu("common.save")}</Button>
              {edit.id && <Button type="button" variant="ghost" className="min-h-11 w-full text-destructive" disabled={busy} onClick={async () => { if (await call("admin_ev_charger_retire", { _id: edit.id }, "Charger retired")) setEdit(null); }}>{tu("op.retire_charger")}</Button>}
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ================= Reports ================= */
export function ReportsTab({ d }: { d: PData }) {
  const names = useNames(d);
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), to: today });
  const rep = useQuery({
    queryKey: ["parking-report", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await rpc("admin_parking_report", { _from: range.from, _to: range.to });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any;
    },
  });
  function download(name: string, rows: unknown[][]) {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  const exportAllocations = () => download(`parking-allocations-${range.from}-${range.to}.csv`, [
    ["Slot", "Kind", "Purpose", "House", "Vehicle", "Starts", "Ends", "Status", "Released", "Reason", "Release reason"],
    ...d.allocs.filter((a) => a.created_at.slice(0, 10) >= range.from && a.created_at.slice(0, 10) <= range.to).map((a) => [
      names.slot.get(a.slot_id) ?? "", a.kind, a.temp_purpose ?? "", a.flat_id ? names.flat.get(a.flat_id) ?? "" : "", a.vehicle_id ? names.plate.get(a.vehicle_id) ?? "" : "",
      a.starts_at, a.ends_at ?? "", allocationState(a), a.released_at ?? "", a.reason ?? "", a.release_reason ?? ""]),
  ]);
  const r = rep.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="r-f">{tu("common.from")}</Label><Input id="r-f" type="date" className="h-11" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
        <div><Label htmlFor="r-t">To</Label><Input id="r-t" type="date" className="h-11" value={range.to} min={range.from} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        <Button variant="outline" className="min-h-11" onClick={exportAllocations}><Download className="mr-2 h-4 w-4" />{tu("op.allocations_csv")}</Button>
        {r && <Button variant="outline" className="min-h-11" onClick={() => download(`parking-daily-${range.from}-${range.to}.csv`, [["Day", "Assigned", "Temporary issued", "Violations", "Visitor parking"], ...r.daily.map((x: Record<string, unknown>) => [x.day, x.assigned, x.temporary, x.violations, x.visitor_parking])])}><Download className="mr-2 h-4 w-4" />{tu("op.daily_csv")}</Button>}
      </div>
      {rep.isLoading ? <ListSkeleton rows={3} /> : rep.isError ? <LoadError title={gateErrorMessage(rep.error)} onRetry={() => void rep.refetch()} /> : r && (
        <>
          <SummaryStrip items={[
            { label: "Slots assigned", value: r.assigned }, { label: "Slots released", value: r.released },
            { label: "Temporary issued", value: r.temporary_issued }, { label: "Temporary expired", value: r.temporary_expired },
          ]} />
          <SummaryStrip items={[
            { label: "Violations", value: Object.values(r.violations_by_type as Record<string, number>).reduce((a, b) => a + b, 0) },
            { label: "Visitor parking uses", value: r.visitor_parking_uses },
            { label: "EV sessions", value: r.ev_sessions },
            { label: "EV energy (meter readings)", value: `${Number(r.ev_energy_entered_kwh).toFixed(1)} kWh`, hint: r.ev_sessions_without_reading ? `${r.ev_sessions_without_reading} without reading` : undefined },
          ]} />
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-4 text-sm"><h3 className="mb-2 font-semibold">{tu("op.violations_by_type")}</h3>
              {Object.keys(r.violations_by_type).length === 0 ? <p className="text-muted-foreground">{tu("op.none_in_this_period")}</p> :
                <ul className="space-y-1">{Object.entries(r.violations_by_type as Record<string, number>).map(([k, v]) => <li key={k} className="flex justify-between"><span>{label(VIOLATION_TYPES, k)}</span><b className="tabular-nums">{v}</b></li>)}</ul>}
            </section>
            <section className="rounded-2xl border border-border bg-card p-4 text-sm"><h3 className="mb-2 font-semibold">{tu("op.repeat_vehicles")}</h3>
              {r.repeat_vehicles.length === 0 ? <p className="text-muted-foreground">{tu("op.no_vehicle_has_more_than")}</p> :
                <ul className="space-y-1">{r.repeat_vehicles.map((x: { plate: string; count: number }) => <li key={x.plate} className="flex justify-between"><span className="font-mono">{x.plate}</span><b className="tabular-nums">{x.count}</b></li>)}</ul>}
            </section>
          </div>
          <section className="overflow-x-auto rounded-2xl border border-border bg-card" aria-label={tu("op.daily_trend")}>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">{tu("op.day")}</th><th className="px-2">{tu("op.assigned")}</th><th className="px-2">{tu("op.temporary")}</th><th className="px-2">{tu("op.violations")}</th><th className="px-2">{tu("gd.visitorParking")}</th></tr></thead>
              <tbody>{r.daily.filter((x: Record<string, number>) => x.assigned || x.temporary || x.violations || x.visitor_parking).map((x: Record<string, string | number>) => (
                <tr key={x.day as string} className="border-t border-border tabular-nums"><td className="px-4 py-2">{x.day}</td><td className="px-2">{x.assigned}</td><td className="px-2">{x.temporary}</td><td className="px-2">{x.violations}</td><td className="px-2">{x.visitor_parking}</td></tr>))}</tbody></table>
            {r.daily.every((x: Record<string, number>) => !x.assigned && !x.temporary && !x.violations && !x.visitor_parking) && <p className="px-4 py-3 text-sm text-muted-foreground">{tu("op.no_parking_activity_in_this")}</p>}
          </section>
        </>
      )}
    </div>
  );
}
