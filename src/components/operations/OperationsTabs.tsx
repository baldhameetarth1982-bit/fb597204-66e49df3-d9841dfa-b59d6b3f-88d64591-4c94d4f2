// Committee Operations: all writes go through SECURITY DEFINER RPCs (society + permission + audit server-side).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Copy, Download, HardHat, History, Loader2, Package, Plus, Truck, Wrench } from "lucide-react";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";
import { useVendorPerformance, perfLabel, VendorPerformancePanel } from "./VendorRatings";
import { tu } from "@/lib/i18n";

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export function opsErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Try again when connected.";
  if (raw.includes("not_authorized") || raw.includes("42501")) return "You don't have permission to do that.";
  if (raw.includes("rate_limited")) return "Too many changes in a short time. Please wait a few minutes.";
  if (raw.includes("insufficient_stock")) return "Not enough stock for that change.";
  if (raw.includes("reason_required")) return "Please add a reason.";
  if (raw.includes("invalid_dates")) return "The end date must be after the start date.";
  if (raw.includes("invalid_date")) return "Choose a valid date (not in the future).";
  if (raw.includes("invalid_expense")) return "That expense isn't available in this society.";
  if (raw.includes("invalid_vendor")) return "That vendor isn't in this society.";
  if (raw.includes("check") || raw.includes("23514") || raw.includes("22023")) return "Some details aren't valid. Check the fields and try again.";
  return "Something went wrong. Please try again.";
}

function useSid() { return useSocietyId().societyId; }
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
function Chip({ tone, children }: { tone: "muted" | "warn" | "bad" | "ok"; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone === "bad" ? "bg-destructive/10 text-destructive" : tone === "warn" ? "bg-warning/15 text-warning-foreground" : tone === "ok" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{children}</span>;
}
function within30(d: string | null) { if (!d) return false; const ms = new Date(d).getTime() - Date.now(); return ms < 30 * 86400_000; }

/* ---------------- Staff ---------------- */
const JOBS = [["housekeeping", "Housekeeping"], ["security", "Security"], ["electrician", "Electrician"], ["plumber", "Plumber"], ["gardener", "Gardener"], ["lift_operator", "Lift operator"], ["manager", "Manager"], ["other", "Other"]] as const;
const jobLabel = (j: string) => JOBS.find((x) => x[0] === j)?.[1] ?? j;
interface StaffRow { id: string; full_name: string; job_type: string; phone: string | null; shift_start: string | null; shift_end: string | null; shift_days: number[]; is_active: boolean; notes: string | null }
const EMPTY_STAFF = { id: null as string | null, name: "", job: "housekeeping", phone: "", start: "", end: "", active: true, notes: "" };

export function StaffTab() {
  const sid = useSid(); const qc = useQueryClient();
  const [form, setForm] = useState<typeof EMPTY_STAFF | null>(null);
  const q = useQuery({
    queryKey: ["ops", "staff", sid], enabled: !!sid,
    queryFn: async () => {
      const [s, a] = await Promise.all([
        supabase.from("society_staff").select("id, full_name, job_type, phone, shift_start, shift_end, shift_days, is_active, notes").eq("society_id", sid!).order("is_active", { ascending: false }).order("full_name").limit(300),
        supabase.from("staff_attendance").select("staff_id, status").eq("society_id", sid!).eq("day", today()),
      ]);
      if (s.error || a.error) throw s.error ?? a.error;
      return { staff: (s.data ?? []) as StaffRow[], att: Object.fromEntries((a.data ?? []).map((r) => [r.staff_id, r.status])) as Record<string, string> };
    },
  });
  const save = useMutation({
    mutationFn: async (f: typeof EMPTY_STAFF) => {
      const { error } = await supabase.rpc("admin_upsert_staff", {
        _id: f.id as string, _name: f.name, _job: f.job, _phone: f.phone, _shift_start: (f.start || null) as string, _shift_end: (f.end || null) as string,
        _days: [1, 2, 3, 4, 5, 6], _active: f.active, _notes: f.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.staff_saved")); setForm(null); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  const mark = useMutation({
    mutationFn: async (v: { staff: string; status: string }) => {
      const { error } = await supabase.rpc("admin_record_attendance", { _staff: v.staff, _day: today(), _status: v.status, _note: "" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.attendance_saved")); qc.invalidateQueries({ queryKey: ["ops", "staff"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{tu("op.staff_records_don_t_create")}</p>
        <Button className="min-h-11 rounded-xl" onClick={() => setForm({ ...EMPTY_STAFF })}><Plus className="mr-1 h-4 w-4" />{tu("vh.add")}</Button>
      </div>
      {!sid || q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={tu("op.couldn_t_load_staff")} onRetry={() => q.refetch()} />
        : !q.data.staff.length ? <ListEmpty icon={HardHat} title={tu("op.no_staff_yet")}>{tu("op.add_housekeeping_security_electricians_a")}</ListEmpty> : (
        <ul className="divide-y rounded-2xl border bg-card">
          {q.data.staff.map((s) => (
            <li key={s.id} className={cn("flex flex-wrap items-center gap-3 p-3", !s.is_active && "opacity-60")}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setForm({ id: s.id, name: s.full_name, job: s.job_type, phone: s.phone ?? "", start: s.shift_start?.slice(0, 5) ?? "", end: s.shift_end?.slice(0, 5) ?? "", active: s.is_active, notes: s.notes ?? "" })}>
                <p className="truncate font-medium">{s.full_name} {!s.is_active && <Chip tone="muted">{tu("common.inactive")}</Chip>}</p>
                <p className="text-xs text-muted-foreground">{jobLabel(s.job_type)}{s.shift_start ? ` · ${s.shift_start.slice(0, 5)}–${s.shift_end?.slice(0, 5) ?? ""}` : ""}{s.phone ? ` · ${s.phone}` : ""}</p>
              </button>
              {s.is_active && (
                <Select value={q.data.att[s.id] ?? ""} onValueChange={(v) => mark.mutate({ staff: s.id, status: v })} disabled={mark.isPending}>
                  <SelectTrigger className="min-h-11 w-36 rounded-xl" aria-label={`Today's attendance for ${s.full_name}`}><SelectValue placeholder={tu("op.today")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">{tu("op.present")}</SelectItem><SelectItem value="half_day">{tu("op.half_day")}</SelectItem>
                    <SelectItem value="leave">{tu("op.on_leave")}</SelectItem><SelectItem value="absent">{tu("op.absent")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!form} onOpenChange={(o) => !o && !save.isPending && setForm(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{form?.id ? tu("op.edit_staff") : tu("op.add_staff")}</SheetTitle></SheetHeader>
          {form && (
            <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <Field id="st-name" label={tu("vs.nameReq")}><Input id="st-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id="st-job" label={tu("op.job")}>
                  <Select value={form.job} onValueChange={(v) => setForm({ ...form, job: v })}>
                    <SelectTrigger id="st-job" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{JOBS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field id="st-phone" label={tu("exp.phone")}><Input id="st-phone" className="h-11" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field id="st-s" label={tu("op.shift_from")}><Input id="st-s" type="time" className="h-11" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
                <Field id="st-e" label={tu("op.shift_to")}><Input id="st-e" type="time" className="h-11" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{tu("common.active")}</label>
              <Button type="submit" className="h-12 w-full rounded-xl" disabled={save.isPending || form.name.trim().length < 2}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("common.save")}</Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* ---------------- Vendors ---------------- */
interface VendorRow { id: string; name: string; category: string | null; phone: string | null; is_active: boolean; contract_type: string; contract_start: string | null; contract_end: string | null; contract_value: number | null; contract_notes: string | null }
export function VendorsTab() {
  const sid = useSid(); const qc = useQueryClient();
  const [edit, setEdit] = useState<VendorRow | null>(null);
  const perf = useVendorPerformance(sid);
  const q = useQuery({
    queryKey: ["ops", "vendors", sid], enabled: !!sid,
    queryFn: async () => {
      const [v, t, a, e] = await Promise.all([
        supabase.from("finance_vendors").select("id, name, category, phone, is_active, contract_type, contract_start, contract_end, contract_value, contract_notes").eq("society_id", sid!).order("is_active", { ascending: false }).order("name").limit(300),
        supabase.from("support_tickets").select("vendor_id").eq("society_id", sid!).not("vendor_id", "is", null).limit(2000),
        supabase.from("society_assets").select("vendor_id").eq("society_id", sid!).not("vendor_id", "is", null).limit(2000),
        supabase.from("expenses").select("vendor_id, amount").eq("society_id", sid!).neq("status", "reversed").not("vendor_id", "is", null).limit(5000),
      ]);
      const err = v.error ?? t.error ?? a.error ?? e.error; if (err) throw err;
      const count = (rows: { vendor_id: string | null }[]) => rows.reduce<Record<string, number>>((m, r) => { if (r.vendor_id) m[r.vendor_id] = (m[r.vendor_id] ?? 0) + 1; return m; }, {});
      const spend = (e.data ?? []).reduce<Record<string, number>>((m, r) => { if (r.vendor_id) m[r.vendor_id] = (m[r.vendor_id] ?? 0) + Number(r.amount); return m; }, {});
      return { vendors: (v.data ?? []) as VendorRow[], tickets: count(t.data ?? []), assets: count(a.data ?? []), spend };
    },
  });
  const save = useMutation({
    mutationFn: async (v: VendorRow) => {
      const { error } = await supabase.rpc("admin_set_vendor_contract", {
        _vendor: v.id, _type: v.contract_type, _start: (v.contract_start || null) as string, _end: (v.contract_end || null) as string,
        _value: (v.contract_value ?? null) as number, _notes: v.contract_notes ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.contract_saved")); setEdit(null); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{tu("op.vendors_are_shared_with_expenses")}</p>
      {!sid || q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={tu("op.couldn_t_load_vendors")} onRetry={() => q.refetch()} />
        : !q.data.vendors.length ? <ListEmpty icon={Truck} title={tu("op.no_vendors_yet")}>{tu("op.add_a_vendor_while_recording")}</ListEmpty> : (
        <ul className="divide-y rounded-2xl border bg-card">
          {q.data.vendors.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => setEdit({ ...v })} className={cn("w-full p-3 text-left hover:bg-muted/60", !v.is_active && "opacity-60")}>
                <p className="flex flex-wrap items-center gap-2 font-medium">{v.name}
                  {v.contract_type !== "none" && <Chip tone={v.contract_end && within30(v.contract_end) ? (new Date(v.contract_end) < new Date() ? "bad" : "warn") : "ok"}>{v.contract_type === "amc" ? "AMC" : tu("op.contract")}{v.contract_end ? ` till ${v.contract_end}` : ""}</Chip>}
                  {!v.is_active && <Chip tone="muted">{tu("common.inactive")}</Chip>}
                </p>
                <p className="text-xs text-muted-foreground">{v.category ?? tu("comm.general")} · {q.data.tickets[v.id] ?? 0} {tu("op.requests")} {q.data.assets[v.id] ?? 0} {tu("op.assets_2")} {inr(q.data.spend[v.id] ?? 0)} {tu("op.spent")} {perf.isError ? tu("op.ratings_unavailable") : perfLabel(perf.data?.[v.id])}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!edit} onOpenChange={(o) => !o && !save.isPending && setEdit(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{edit?.name} — contract</SheetTitle></SheetHeader>
          {edit && (
            <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); save.mutate(edit); }}>
              <Field id="vc-type" label={tu("cm.type")}>
                <Select value={edit.contract_type} onValueChange={(v) => setEdit({ ...edit, contract_type: v })}>
                  <SelectTrigger id="vc-type" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">{tu("op.no_contract")}</SelectItem><SelectItem value="contract">{tu("op.service_contract")}</SelectItem><SelectItem value="amc">AMC</SelectItem></SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id="vc-s" label={tu("op.start")}><Input id="vc-s" type="date" className="h-11" value={edit.contract_start ?? ""} onChange={(e) => setEdit({ ...edit, contract_start: e.target.value })} /></Field>
                <Field id="vc-e" label={tu("op.end")}><Input id="vc-e" type="date" className="h-11" value={edit.contract_end ?? ""} onChange={(e) => setEdit({ ...edit, contract_end: e.target.value })} /></Field>
              </div>
              <Field id="vc-v" label={tu("op.contract_value_for_reference")}><Input id="vc-v" type="number" min={0} step="0.01" className="h-11" value={edit.contract_value ?? ""} onChange={(e) => setEdit({ ...edit, contract_value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field id="vc-n" label={tu("exp.notes")}><Input id="vc-n" className="h-11" maxLength={500} value={edit.contract_notes ?? ""} onChange={(e) => setEdit({ ...edit, contract_notes: e.target.value })} /></Field>
              <p className="text-xs text-muted-foreground">{tu("op.recording_a_contract_doesn_t")}</p>
              <Button type="submit" className="h-12 w-full rounded-xl" disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("common.save")}</Button>
            </form>
          )}
          {edit && <VendorPerformancePanel vendorId={edit.id} perf={perf.data?.[edit.id]} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* ---------------- Assets ---------------- */
const CATS = [["lift", "Lift"], ["pump", "Water pump"], ["generator", "Generator"], ["electrical", "Electrical"], ["plumbing", "Plumbing"], ["fire_safety", "Fire safety"], ["cctv", "CCTV"], ["gym", "Gym"], ["garden", "Garden"], ["other", "Other"]] as const;
const catLabel = (c: string) => CATS.find((x) => x[0] === c)?.[1] ?? c;
interface AssetRow { id: string; name: string; category: string; location: string | null; status: string; purchase_date: string | null; installed_on: string | null; warranty_until: string | null; amc_until: string | null; vendor_id: string | null; qr_token: string; notes: string | null }
const EMPTY_ASSET = { id: null as string | null, name: "", category: "lift", location: "", status: "active", purchase: "", installed: "", warranty: "", amc: "", vendor: "", notes: "" };

export function AssetsTab() {
  const sid = useSid(); const qc = useQueryClient();
  const [form, setForm] = useState<typeof EMPTY_ASSET | null>(null);
  const [open, setOpen] = useState<AssetRow | null>(null);
  const q = useQuery({
    queryKey: ["ops", "assets", sid], enabled: !!sid,
    queryFn: async () => {
      const [a, v, t] = await Promise.all([
        supabase.from("society_assets").select("id, name, category, location, status, purchase_date, installed_on, warranty_until, amc_until, vendor_id, qr_token, notes").eq("society_id", sid!).order("status").order("name").limit(500),
        supabase.from("finance_vendors").select("id, name").eq("society_id", sid!).eq("is_active", true).order("name").limit(300),
        supabase.from("support_tickets").select("asset_id").eq("society_id", sid!).not("asset_id", "is", null).limit(5000),
      ]);
      const err = a.error ?? v.error ?? t.error; if (err) throw err;
      const tc = (t.data ?? []).reduce<Record<string, number>>((m, r) => { if (r.asset_id) m[r.asset_id] = (m[r.asset_id] ?? 0) + 1; return m; }, {});
      return { assets: (a.data ?? []) as AssetRow[], vendors: v.data ?? [], tickets: tc };
    },
  });
  const save = useMutation({
    mutationFn: async (f: typeof EMPTY_ASSET) => {
      const n = (x: string) => (x || null) as string;
      const { error } = await supabase.rpc("admin_upsert_asset", {
        _id: f.id as string, _name: f.name, _category: f.category, _location: f.location, _status: f.status,
        _purchase: n(f.purchase), _installed: n(f.installed), _warranty: n(f.warranty), _amc: n(f.amc), _vendor: n(f.vendor), _notes: f.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.asset_saved")); setForm(null); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  const vendorName = (id: string | null) => q.data?.vendors.find((v) => v.id === id)?.name;
  return (
    <section className="space-y-3">
      <div className="flex justify-end"><Button className="min-h-11 rounded-xl" onClick={() => setForm({ ...EMPTY_ASSET })}><Plus className="mr-1 h-4 w-4" />{tu("op.add_asset")}</Button></div>
      {!sid || q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={tu("op.couldn_t_load_assets")} onRetry={() => q.refetch()} />
        : !q.data.assets.length ? <ListEmpty icon={Wrench} title={tu("op.no_assets_yet")}>{tu("op.add_lifts_pumps_generators_and")}</ListEmpty> : (
        <ul className="divide-y rounded-2xl border bg-card">
          {q.data.assets.map((a) => {
            const soon = [a.warranty_until, a.amc_until].some(within30);
            const repeat = (q.data.tickets[a.id] ?? 0) >= 3;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setOpen(a)} className={cn("w-full p-3 text-left hover:bg-muted/60", a.status === "retired" && "opacity-60")}>
                  <p className="flex flex-wrap items-center gap-2 font-medium">{a.name}
                    {a.status === "under_repair" && <Chip tone="warn">{tu("op.under_repair")}</Chip>}
                    {a.status === "retired" && <Chip tone="muted">{tu("op.retired")}</Chip>}
                    {soon && <Chip tone="warn">{tu("op.warranty_amc_ending")}</Chip>}
                    {repeat && <Chip tone="bad">{tu("op.repeat_issues")}</Chip>}
                  </p>
                  <p className="text-xs text-muted-foreground">{catLabel(a.category)}{a.location ? ` · ${a.location}` : ""}{vendorName(a.vendor_id) ? ` · ${vendorName(a.vendor_id)}` : ""} · {q.data.tickets[a.id] ?? 0} {tu("op.requests_2")}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && q.data && sid && <AssetDetail sid={sid} asset={open} vendors={q.data.vendors} onClose={() => setOpen(null)}
        onEdit={() => { setForm({ id: open.id, name: open.name, category: open.category, location: open.location ?? "", status: open.status, purchase: open.purchase_date ?? "", installed: open.installed_on ?? "", warranty: open.warranty_until ?? "", amc: open.amc_until ?? "", vendor: open.vendor_id ?? "", notes: open.notes ?? "" }); setOpen(null); }} />}
      <Sheet open={!!form} onOpenChange={(o) => !o && !save.isPending && setForm(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>{form?.id ? tu("op.edit_asset") : tu("op.add_asset")}</SheetTitle></SheetHeader>
          {form && (
            <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <Field id="as-name" label={tu("vs.nameReq")}><Input id="as-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id="as-cat" label={tu("common.category")}>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger id="as-cat" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field id="as-st" label={tu("common.status")}>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger id="as-st" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="active">{tu("common.active")}</SelectItem><SelectItem value="under_repair">{tu("op.under_repair")}</SelectItem><SelectItem value="retired">{tu("op.retired")}</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field id="as-loc" label={tu("pk.location")}><Input id="as-loc" className="h-11" maxLength={80} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
                <Field id="as-v" label={tu("vs.cat.vendor")}>
                  <Select value={form.vendor || "none"} onValueChange={(v) => setForm({ ...form, vendor: v === "none" ? "" : v })}>
                    <SelectTrigger id="as-v" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{tu("el.a.none")}</SelectItem>{(q.data?.vendors ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field id="as-p" label={tu("op.purchased")}><Input id="as-p" type="date" className="h-11" value={form.purchase} onChange={(e) => setForm({ ...form, purchase: e.target.value })} /></Field>
                <Field id="as-i" label={tu("op.installed")}><Input id="as-i" type="date" className="h-11" value={form.installed} onChange={(e) => setForm({ ...form, installed: e.target.value })} /></Field>
                <Field id="as-w" label={tu("op.warranty_until")}><Input id="as-w" type="date" className="h-11" value={form.warranty} onChange={(e) => setForm({ ...form, warranty: e.target.value })} /></Field>
                <Field id="as-a" label={tu("op.amc_until")}><Input id="as-a" type="date" className="h-11" value={form.amc} onChange={(e) => setForm({ ...form, amc: e.target.value })} /></Field>
              </div>
              <Button type="submit" className="h-12 w-full rounded-xl" disabled={save.isPending || form.name.trim().length < 2}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("common.save")}</Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function AssetDetail({ sid, asset, vendors, onClose, onEdit }: { sid: string; asset: AssetRow; vendors: { id: string; name: string }[]; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ date: today(), kind: "service", vendor: asset.vendor_id ?? "", expense: "", ticket: "", notes: "" });
  const q = useQuery({
    queryKey: ["ops", "asset", asset.id],
    queryFn: async () => {
      const [l, t, e] = await Promise.all([
        supabase.from("asset_service_log").select("id, service_date, kind, notes, expense_id, ticket_id, vendor_id").eq("asset_id", asset.id).order("service_date", { ascending: false }).limit(100),
        supabase.from("support_tickets").select("id, ticket_no, subject, status").eq("asset_id", asset.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("expenses").select("id, category, amount, spent_on").eq("society_id", sid).neq("status", "reversed").order("spent_on", { ascending: false }).limit(50),
      ]);
      const err = l.error ?? t.error ?? e.error; if (err) throw err;
      return { log: l.data ?? [], tickets: t.data ?? [], expenses: e.data ?? [] };
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const n = (x: string) => (x || null) as string;
      const { error } = await supabase.rpc("admin_add_asset_service", { _asset: asset.id, _date: f.date, _kind: f.kind, _ticket: n(f.ticket), _vendor: n(f.vendor), _expense: n(f.expense), _notes: f.notes });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.service_entry_added")); setF({ ...f, notes: "", expense: "", ticket: "" }); qc.invalidateQueries({ queryKey: ["ops"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  const qrUrl = typeof window !== "undefined" ? `${window.location.origin}/asset/${asset.qr_token}` : "";
  const expLabel = (id: string | null) => { const x = q.data?.expenses.find((e) => e.id === id); return x ? `${x.category} ${inr(x.amount)}` : null; };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="text-left"><SheetTitle>{asset.name}</SheetTitle></SheetHeader>
        <div className="space-y-4 py-4 text-sm">
          <p className="text-muted-foreground">{catLabel(asset.category)}{asset.location ? ` · ${asset.location}` : ""} · Warranty {asset.warranty_until ?? "—"} · AMC {asset.amc_until ?? "—"}</p>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 flex-1 rounded-xl" onClick={onEdit}>{tu("common.edit")}</Button>
            <Button variant="outline" className="min-h-11 flex-1 rounded-xl" onClick={() => { void navigator.clipboard?.writeText(qrUrl); toast.success(tu("op.qr_link_copied")); }}><Copy className="mr-1 h-4 w-4" />{tu("op.copy_qr_link")}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{tu("op.the_qr_link_shows_only")}</p>
          {q.isPending ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : q.isError ? <p className="text-destructive">{tu("op.couldn_t_load_history")}</p> : (
            <>
              <section className="space-y-2">
                <h3 className="font-medium">{tu("op.linked_requests")}</h3>
                {!q.data.tickets.length ? <p className="text-xs text-muted-foreground">{tu("op.none_link_from_a_helpdesk")}</p> : (
                  <ul className="space-y-1">{q.data.tickets.map((t) => <li key={t.id} className="text-xs">#{t.ticket_no} {t.subject} · {t.status.replace("_", " ")}</li>)}</ul>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-medium">{tu("op.service_history")}</h3>
                {!q.data.log.length ? <p className="text-xs text-muted-foreground">{tu("op.no_service_entries_yet")}</p> : (
                  <ul className="space-y-2">{q.data.log.map((l) => (
                    <li key={l.id} className="rounded-xl border p-2 text-xs">
                      <span className="font-medium capitalize">{l.kind.replace("_", " ")}</span> · {l.service_date}{expLabel(l.expense_id) ? ` · ${expLabel(l.expense_id)}` : ""}
                      {l.notes && <p className="text-muted-foreground">{l.notes}</p>}
                    </li>))}</ul>
                )}
              </section>
              <form className="space-y-2 rounded-2xl border p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
                <p className="font-medium">{tu("op.add_service_entry")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" className="h-11" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label={tu("op.service_date")} />
                  <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
                    <SelectTrigger className="h-11" aria-label={tu("op.service_type")}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="service">{tu("vs.cat.service")}</SelectItem><SelectItem value="repair">{tu("vch.kind.repair")}</SelectItem><SelectItem value="amc_visit">{tu("op.amc_visit")}</SelectItem><SelectItem value="inspection">{tu("op.inspection")}</SelectItem></SelectContent>
                  </Select>
                  <Select value={f.vendor || "none"} onValueChange={(v) => setF({ ...f, vendor: v === "none" ? "" : v })}>
                    <SelectTrigger className="h-11" aria-label={tu("vs.cat.vendor")}><SelectValue placeholder={tu("vs.cat.vendor")} /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{tu("exp.noVendor")}</SelectItem>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={f.expense || "none"} onValueChange={(v) => setF({ ...f, expense: v === "none" ? "" : v })}>
                    <SelectTrigger className="h-11" aria-label={tu("op.linked_expense")}><SelectValue placeholder={tu("acc.expense")} /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{tu("op.no_expense")}</SelectItem>{q.data.expenses.map((x) => <SelectItem key={x.id} value={x.id}>{x.spent_on} · {x.category} · {inr(x.amount)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={f.ticket || "none"} onValueChange={(v) => setF({ ...f, ticket: v === "none" ? "" : v })}>
                    <SelectTrigger className="col-span-2 h-11" aria-label={tu("op.linked_request")}><SelectValue placeholder={tu("prof.wd.request")} /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{tu("op.no_request")}</SelectItem>{q.data.tickets.map((t) => <SelectItem key={t.id} value={t.id}>#{t.ticket_no} {t.subject}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Input className="h-11" maxLength={500} placeholder={tu("exp.notes")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} aria-label={tu("exp.notes")} />
                <p className="text-xs text-muted-foreground">{tu("op.linking_an_expense_is_a")}</p>
                <Button type="submit" className="min-h-11 w-full rounded-xl" disabled={add.isPending}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("op.add_entry")}</Button>
              </form>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Inventory ---------------- */
interface ItemRow { id: string; name: string; location: string | null; unit: string; quantity: number; reorder_level: number; is_active: boolean }
const isLow = (i: ItemRow) => i.is_active && Number(i.reorder_level) > 0 && Number(i.quantity) <= Number(i.reorder_level);
function exportInventory(rows: ItemRow[]) {
  writeSafeWorkbook(rows.map((i) => ({
    Item: i.name, Location: i.location ?? "", Unit: i.unit, Quantity: Number(i.quantity),
    "Reorder at": Number(i.reorder_level), Status: !i.is_active ? "Inactive" : isLow(i) ? "Low stock" : "OK",
  })), "Inventory", `inventory-${today()}.xlsx`);
}
function StockHistorySheet({ item, onClose }: { item: ItemRow | null; onClose: () => void }) {
  const sid = useSid();
  const q = useQuery({
    queryKey: ["ops", "inventory-moves", item?.id], enabled: !!item && !!sid,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_movements").select("id, delta, resulting_qty, reason, created_at").eq("society_id", sid!).eq("item_id", item!.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader><SheetTitle>{tu("op.stock_history")} {item?.name}</SheetTitle></SheetHeader>
        <div className="py-4">
          {q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={tu("op.couldn_t_load_stock_history")} onRetry={() => q.refetch()} />
            : !q.data.length ? <ListEmpty icon={History} title={tu("op.no_changes_yet")}>{tu("op.stock_changes_will_show_here")}</ListEmpty> : (
            <ul className="divide-y rounded-2xl border bg-card">
              {q.data.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{m.reason}</p>
                    <p className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} · left {Number(m.resulting_qty)} {item?.unit}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-semibold tabular-nums", Number(m.delta) < 0 ? "text-destructive" : "text-success")}>{Number(m.delta) > 0 ? "+" : ""}{Number(m.delta)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
export function InventoryTab() {
  const sid = useSid(); const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ name: "", location: "", unit: "pcs", reorder: "0" });
  const [adj, setAdj] = useState<{ item: ItemRow; delta: string; reason: string } | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [hist, setHist] = useState<ItemRow | null>(null);
  const q = useQuery({
    queryKey: ["ops", "inventory", sid], enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("id, name, location, unit, quantity, reorder_level, is_active").eq("society_id", sid!).order("is_active", { ascending: false }).order("name").limit(500);
      if (error) throw error;
      return (data ?? []) as ItemRow[];
    },
  });
  const lowCount = (q.data ?? []).filter(isLow).length;
  const shown = (q.data ?? []).filter((i) => !lowOnly || isLow(i));
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_upsert_inventory_item", { _id: null as unknown as string, _name: nf.name, _location: nf.location, _unit: nf.unit, _reorder: Number(nf.reorder) || 0, _active: true });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.item_added")); setAdding(false); setNf({ name: "", location: "", unit: "pcs", reorder: "0" }); qc.invalidateQueries({ queryKey: ["ops", "inventory"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  const adjust = useMutation({
    mutationFn: async (a: NonNullable<typeof adj>) => {
      const { error } = await supabase.rpc("admin_adjust_inventory", { _item: a.item.id, _delta: Number(a.delta), _reason: a.reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(tu("op.stock_updated")); setAdj(null); qc.invalidateQueries({ queryKey: ["ops", "inventory"] }); },
    onError: (e) => toast.error(opsErrorMessage(e)),
  });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{tu("op.quantities_only_record_purchases_as")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant={lowOnly ? "default" : "outline"} className="min-h-11 rounded-xl" aria-pressed={lowOnly} onClick={() => setLowOnly((v) => !v)}>{tu("op.low_stock")}{lowCount ? ` (${lowCount})` : ""}</Button>
          <Button variant="outline" className="min-h-11 rounded-xl" disabled={!q.data?.length} onClick={() => q.data && exportInventory(q.data)}><Download className="mr-1 h-4 w-4" />{tu("common.download")}</Button>
          <Button className="min-h-11 rounded-xl" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />{tu("op.add_item")}</Button>
        </div>
      </div>
      {!sid || q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title={tu("op.couldn_t_load_inventory")} onRetry={() => q.refetch()} />
        : !q.data.length ? <ListEmpty icon={Boxes} title={tu("op.no_items_yet")}>{tu("op.track_bulbs_cleaning_supplies_spares")}</ListEmpty>
        : !shown.length ? <ListEmpty icon={Boxes} title={tu("op.nothing_is_low_on_stock")}>{tu("op.every_item_is_above_its")}</ListEmpty> : (
        <ul className="divide-y rounded-2xl border bg-card">
          {shown.map((i) => (
            <li key={i.id} className={cn("flex items-center gap-3 p-3", !i.is_active && "opacity-60")}>
              <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">{i.name}{isLow(i) && <Chip tone="bad">{tu("op.low_stock")}</Chip>}</p>
                <p className="text-xs text-muted-foreground">{Number(i.quantity)} {i.unit}{i.location ? ` · ${i.location}` : ""} · reorder at {Number(i.reorder_level)}</p>
              </div>
              <Button variant="ghost" className="min-h-11 rounded-xl" onClick={() => setHist(i)} aria-label={`Stock history for ${i.name}`}><History className="h-4 w-4" /></Button>
              <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setAdj({ item: i, delta: "", reason: "" })}>{tu("op.adjust")}</Button>
            </li>
          ))}
        </ul>
      )}
      <StockHistorySheet item={hist} onClose={() => setHist(null)} />

      <Sheet open={adding} onOpenChange={(o) => !o && !create.isPending && setAdding(false)}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-3xl">
          <SheetHeader><SheetTitle>{tu("op.add_item")}</SheetTitle></SheetHeader>
          <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field id="in-name" label={tu("vs.nameReq")}><Input id="in-name" className="h-11" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field id="in-loc" label={tu("pk.location")}><Input id="in-loc" className="h-11" value={nf.location} onChange={(e) => setNf({ ...nf, location: e.target.value })} /></Field>
              <Field id="in-unit" label={tu("nd.unit")}><Input id="in-unit" className="h-11" maxLength={16} value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })} /></Field>
              <Field id="in-re" label={tu("op.reorder_at")}><Input id="in-re" type="number" min={0} className="h-11" value={nf.reorder} onChange={(e) => setNf({ ...nf, reorder: e.target.value })} /></Field>
            </div>
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={create.isPending || nf.name.trim().length < 2}>{tu("vh.add")}</Button>
          </form>
        </SheetContent>
      </Sheet>
      <Sheet open={!!adj} onOpenChange={(o) => !o && !adjust.isPending && setAdj(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-3xl">
          <SheetHeader><SheetTitle>{tu("op.adjust")} {adj?.item.name}</SheetTitle></SheetHeader>
          {adj && (
            <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); adjust.mutate(adj); }}>
              <p className="text-sm text-muted-foreground">{tu("op.now_2")} {Number(adj.item.quantity)} {adj.item.unit}. Use a negative number to remove stock.</p>
              <Field id="adj-d" label={tu("op.change")}><Input id="adj-d" type="number" step="0.01" className="h-11" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} required /></Field>
              <Field id="adj-r" label={tu("el.a.reasonLbl")}><Input id="adj-r" className="h-11" maxLength={200} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} required minLength={3} /></Field>
              <Button type="submit" className="h-12 w-full rounded-xl" disabled={adjust.isPending || !Number(adj.delta) || adj.reason.trim().length < 3}>{tu("common.save")}</Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
