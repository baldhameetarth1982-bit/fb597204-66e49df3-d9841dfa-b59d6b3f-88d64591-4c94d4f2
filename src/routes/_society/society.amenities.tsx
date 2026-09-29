import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Loader2, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { ListEmpty, ListSkeleton, LoadError, StatusChip, SummaryStrip } from "@/components/people/PeopleUI";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { AMENITY_STATUS_LABELS, AMENITY_TYPE_LABELS, amenityError, localDateTime, type Amenity, type AmenityBooking, type AmenityStatus, type AmenityType } from "@/lib/amenities";

export const Route = createFileRoute("/_society/society/amenities")({
  head: () => ({ meta: [{ title: "Amenities — SociyoHub" }, { name: "description", content: "Configure amenities, oversee bookings, and review fair access." }] }),
  component: AdminAmenities,
});

type FairnessRow = { flat_id: string; flat_label: string; bookings: number; cancellations: number; no_shows: number; peak_bookings: number; waitlisted: number };
type BlockedDate = { id: string; amenity_id: string; blocked_date: string; reason: string | null };
const blank = { id: null as string | null, name: "", description: "", amenity_type: "clubhouse" as AmenityType, opens_at: "06:00", closes_at: "22:00", slot_minutes: 60, capacity: 1, advance_days: 30, cancellation_hours: 2, weekly_household_limit: "", owner_allowed: true, tenant_allowed: true, defaulters_allowed: true, deposit_amount: 0, fee_amount: 0, is_active: true };
const statusTone = (s: AmenityStatus) => s === "confirmed" || s === "completed" ? "success" : s === "waitlisted" ? "warning" : "muted";

function AdminAmenities() {
  const { societyId } = useSocietyId();
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [bookings, setBookings] = useState<AmenityBooking[]>([]);
  const [fairness, setFairness] = useState<FairnessRow[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blank);
  const [blockAmenity, setBlockAmenity] = useState("");
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  async function load() {
    if (!societyId) return;
    setLoading(true); setFailed(false);
    const from = new Date(); from.setDate(from.getDate() - 90);
    const [a, b, f, d] = await Promise.all([
      supabase.from("amenities").select("id,society_id,name,description,amenity_type,opens_at,closes_at,slot_minutes,capacity,advance_days,cancellation_hours,weekly_household_limit,owner_allowed,tenant_allowed,defaulters_allowed,deposit_amount,fee_amount,is_active").eq("society_id", societyId).order("name"),
      supabase.from("amenity_bookings").select("id,amenity_id,flat_id,starts_at,ends_at,attendees,status,cancellation_reason,amenities(name)").eq("society_id", societyId).order("starts_at", { ascending: false }).limit(200),
      supabase.rpc("get_amenity_fairness", { _society_id: societyId, _from: from.toISOString().slice(0,10), _to: new Date().toISOString().slice(0,10) }),
      supabase.from("amenity_blocked_dates").select("id,amenity_id,blocked_date,reason").eq("society_id", societyId).gte("blocked_date", new Date().toISOString().slice(0,10)).order("blocked_date").limit(100),
    ]);
    if (a.error || b.error || f.error || d.error) setFailed(true); else { setAmenities((a.data ?? []) as Amenity[]); setBookings((b.data ?? []) as unknown as AmenityBooking[]); setFairness((f.data ?? []) as unknown as FairnessRow[]); setBlockedDates((d.data ?? []) as BlockedDate[]); }
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [societyId]);

  const active = amenities.filter((a) => a.is_active).length;
  const upcoming = useMemo(() => bookings.filter((b) => ["confirmed", "waitlisted"].includes(b.status) && new Date(b.ends_at) > new Date()), [bookings]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!societyId || saving) return; setSaving(true);
    const { error } = await (supabase as any).rpc("admin_upsert_amenity", {
      _id: form.id, _society_id: societyId, _name: form.name, _description: form.description,
      _amenity_type: form.amenity_type, _opens_at: form.opens_at, _closes_at: form.closes_at,
      _slot_minutes: form.slot_minutes, _capacity: form.capacity, _advance_days: form.advance_days,
      _cancellation_hours: form.cancellation_hours, _weekly_household_limit: form.weekly_household_limit ? Number(form.weekly_household_limit) : null,
      _owner_allowed: form.owner_allowed, _tenant_allowed: form.tenant_allowed, _defaulters_allowed: form.defaulters_allowed,
      _deposit_amount: form.deposit_amount, _fee_amount: form.fee_amount, _is_active: form.is_active,
    });
    setSaving(false); if (error) return toast.error(amenityError(error));
    toast.success(form.id ? "Amenity updated" : "Amenity created"); setOpen(false); setForm(blank); void load();
  }

  async function blockDateSubmit(e: React.FormEvent) {
    e.preventDefault(); if (!blockAmenity || !blockDate) return;
    const { error } = await supabase.rpc("admin_set_amenity_block", { _amenity_id: blockAmenity, _blocked_date: blockDate, _reason: blockReason, _blocked: true });
    if (error) return toast.error(amenityError(error));
    toast.success("Date blocked"); setBlockDate(""); setBlockReason(""); void load();
  }

  async function unblock(d: BlockedDate) {
    const { error } = await supabase.rpc("admin_set_amenity_block", { _amenity_id: d.amenity_id, _blocked_date: d.blocked_date, _reason: d.reason ?? "", _blocked: false });
    if (error) return toast.error(amenityError(error)); toast.success("Date reopened"); void load();
  }

  async function mark(id: string, status: "completed" | "no_show") {
    const { error } = await supabase.rpc("admin_set_amenity_booking_status", { _booking_id: id, _status: status });
    if (error) return toast.error(amenityError(error)); toast.success(status === "completed" ? "Booking completed" : "No-show recorded"); void load();
  }

  function edit(a: Amenity) {
    setForm({ id:a.id,name:a.name,description:a.description ?? "",amenity_type:a.amenity_type,opens_at:a.opens_at.slice(0,5),closes_at:a.closes_at.slice(0,5),slot_minutes:a.slot_minutes,capacity:a.capacity,advance_days:a.advance_days,cancellation_hours:a.cancellation_hours,weekly_household_limit:a.weekly_household_limit?.toString() ?? "",owner_allowed:a.owner_allowed,tenant_allowed:a.tenant_allowed,defaulters_allowed:a.defaulters_allowed,deposit_amount:Number(a.deposit_amount),fee_amount:Number(a.fee_amount),is_active:a.is_active }); setOpen(true);
  }

  return <PageShell>
    <PageHeader title="Amenities" description="Configure shared spaces, oversee bookings, and review access patterns without automatic penalties." actions={<Button className="min-h-11" onClick={() => { setForm(blank); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add amenity</Button>} />
    <SummaryStrip items={[{ label:"Amenities",value:loading?"—":amenities.length },{ label:"Open for booking",value:loading?"—":active },{ label:"Upcoming",value:loading?"—":upcoming.length },{ label:"Waitlisted",value:loading?"—":upcoming.filter((b)=>b.status==="waitlisted").length }]} />
    {loading ? <ListSkeleton rows={5} /> : failed ? <LoadError title="We couldn't load amenities." onRetry={() => void load()} /> : <Tabs defaultValue="amenities">
      <TabsList className="mb-4 w-full justify-start overflow-x-auto"><TabsTrigger value="amenities">Amenities</TabsTrigger><TabsTrigger value="bookings">Bookings</TabsTrigger><TabsTrigger value="fairness">Fair access</TabsTrigger></TabsList>
      <TabsContent value="amenities" className="space-y-5">
        {amenities.length === 0 ? <ListEmpty icon={CalendarDays} title="No amenities yet">Add the first shared space and its booking rules.</ListEmpty> : <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{amenities.map((a)=><li key={a.id}><button type="button" onClick={()=>edit(a)} className="h-full min-h-11 w-full rounded-2xl border bg-card p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex justify-between gap-2"><div><p className="font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{AMENITY_TYPE_LABELS[a.amenity_type]}</p></div><StatusChip tone={a.is_active?"success":"muted"}>{a.is_active?"Active":"Paused"}</StatusChip></div><p className="mt-3 text-sm">{a.opens_at.slice(0,5)}–{a.closes_at.slice(0,5)} · {a.slot_minutes} min · capacity {a.capacity}</p><p className="mt-1 text-xs text-muted-foreground">Book {a.advance_days} days ahead · cancel {a.cancellation_hours} hours before</p></button></li>)}</ul>}
        <form onSubmit={blockDateSubmit} className="grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end"><div><Label>Block an amenity</Label><Select value={blockAmenity} onValueChange={setBlockAmenity}><SelectTrigger className="h-11"><SelectValue placeholder="Choose amenity" /></SelectTrigger><SelectContent>{amenities.filter((a)=>a.is_active).map((a)=><SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="block-date">Date</Label><Input id="block-date" type="date" className="h-11" min={new Date().toISOString().slice(0,10)} value={blockDate} onChange={(e)=>setBlockDate(e.target.value)} required /></div><div><Label htmlFor="block-reason">Reason</Label><Input id="block-reason" className="h-11" maxLength={300} placeholder="Maintenance" value={blockReason} onChange={(e)=>setBlockReason(e.target.value)} /></div><Button className="min-h-11" type="submit">Block date</Button></form>
        {blockedDates.length>0&&<div><h2 className="mb-2 text-sm font-semibold">Upcoming blocked dates</h2><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{blockedDates.map((d)=><li key={d.id} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{amenities.find((a)=>a.id===d.amenity_id)?.name ?? "Amenity"}</p><p className="text-sm text-muted-foreground">{new Date(`${d.blocked_date}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}{d.reason?` · ${d.reason}`:""}</p></div><Button variant="outline" className="min-h-11" onClick={()=>void unblock(d)}>Reopen</Button></li>)}</ul></div>}
      </TabsContent>
      <TabsContent value="bookings">{bookings.length===0?<ListEmpty icon={CalendarDays} title="No bookings yet" />:<ul className="divide-y overflow-hidden rounded-2xl border bg-card">{bookings.map((b)=><li key={b.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><p className="font-medium">{b.amenities?.name ?? "Amenity"}</p><StatusChip tone={statusTone(b.status)}>{AMENITY_STATUS_LABELS[b.status]}</StatusChip></div><p className="text-sm text-muted-foreground">{localDateTime(b.starts_at)} · {b.attendees} people</p></div>{b.status==="confirmed"&&new Date(b.ends_at)<new Date()&&<div className="flex gap-2"><Button variant="outline" className="min-h-11" onClick={()=>void mark(b.id,"no_show")}>No-show</Button><Button className="min-h-11" onClick={()=>void mark(b.id,"completed")}>Complete</Button></div>}</li>)}</ul>}</TabsContent>
      <TabsContent value="fairness"><div className="mb-4 rounded-2xl bg-info-container p-4 text-sm text-info-container-foreground"><BarChart3 className="mb-2 h-5 w-5" />This 90-day view highlights booking distribution, cancellations, no-shows, peak demand, and waitlists. It never restricts or penalizes a household automatically.</div>{fairness.length===0?<ListEmpty icon={BarChart3} title="No booking patterns yet" />:<div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">House</th><th className="p-3">Bookings</th><th className="p-3">Peak</th><th className="p-3">Waitlisted</th><th className="p-3">Cancelled</th><th className="p-3">No-shows</th></tr></thead><tbody className="divide-y bg-card">{fairness.map((r)=><tr key={r.flat_id}><td className="p-3 font-medium">{r.flat_label}</td><td className="p-3 tabular-nums">{r.bookings}</td><td className="p-3 tabular-nums">{r.peak_bookings}</td><td className="p-3 tabular-nums">{r.waitlisted}</td><td className="p-3 tabular-nums">{r.cancellations}</td><td className="p-3 tabular-nums">{r.no_shows}</td></tr>)}</tbody></table></div>}</TabsContent>
    </Tabs>}

    <Dialog open={open} onOpenChange={(o)=>!saving&&setOpen(o)}><DialogContent className="max-h-[92dvh] overflow-y-auto"><DialogHeader><DialogTitle>{form.id?"Edit amenity":"Add amenity"}</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={save}>
      <div className="space-y-1"><Label htmlFor="am-name">Name</Label><Input id="am-name" className="h-11" minLength={2} maxLength={100} required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} /></div>
      <div className="space-y-1"><Label htmlFor="am-desc">Description</Label><Textarea id="am-desc" maxLength={1000} value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} /></div>
      <div className="space-y-1"><Label>Type</Label><Select value={form.amenity_type} onValueChange={(v)=>setForm({...form,amenity_type:v as AmenityType})}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(AMENITY_TYPE_LABELS) as AmenityType[]).map((t)=><SelectItem key={t} value={t}>{AMENITY_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="am-open">Opens</Label><Input id="am-open" type="time" className="h-11" value={form.opens_at} onChange={(e)=>setForm({...form,opens_at:e.target.value})} /></div><div><Label htmlFor="am-close">Closes</Label><Input id="am-close" type="time" className="h-11" value={form.closes_at} onChange={(e)=>setForm({...form,closes_at:e.target.value})} /></div></div>
      <div className="grid grid-cols-2 gap-3"><Num id="am-slot" label="Slot minutes" value={form.slot_minutes} min={15} max={720} onChange={(v)=>setForm({...form,slot_minutes:v})} /><Num id="am-cap" label="Capacity" value={form.capacity} min={1} max={500} onChange={(v)=>setForm({...form,capacity:v})} /></div>
      <div className="grid grid-cols-2 gap-3"><Num id="am-advance" label="Book ahead (days)" value={form.advance_days} min={0} max={365} onChange={(v)=>setForm({...form,advance_days:v})} /><Num id="am-cancel" label="Cancel before (hours)" value={form.cancellation_hours} min={0} max={720} onChange={(v)=>setForm({...form,cancellation_hours:v})} /></div>
      <div><Label htmlFor="am-limit">Weekly household limit <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="am-limit" type="number" className="h-11" min={1} max={100} value={form.weekly_household_limit} onChange={(e)=>setForm({...form,weekly_household_limit:e.target.value})} /></div>
      <div className="grid grid-cols-2 gap-3"><Num id="am-fee" label="Configured fee (₹)" value={form.fee_amount} min={0} max={10000000} onChange={(v)=>setForm({...form,fee_amount:v})} /><Num id="am-deposit" label="Deposit (₹)" value={form.deposit_amount} min={0} max={10000000} onChange={(v)=>setForm({...form,deposit_amount:v})} /></div>
      <p className="text-xs text-muted-foreground">Fees and deposits are informational configuration only. Amenity booking does not create a payment or ledger entry.</p>
      <div className="grid gap-2"><Toggle label="Owners may book" checked={form.owner_allowed} onChange={(v)=>setForm({...form,owner_allowed:v})} /><Toggle label="Tenants may book" checked={form.tenant_allowed} onChange={(v)=>setForm({...form,tenant_allowed:v})} /><Toggle label="Homes with overdue maintenance may book" checked={form.defaulters_allowed} onChange={(v)=>setForm({...form,defaulters_allowed:v})} /><Toggle label="Open for booking" checked={form.is_active} onChange={(v)=>setForm({...form,is_active:v})} /></div>
      <Button type="submit" className="h-12 w-full" disabled={saving}>{saving?<Loader2 className="h-4 w-4 animate-spin" />:<><Settings2 className="mr-2 h-4 w-4" />Save amenity</>}</Button>
    </form></DialogContent></Dialog>
  </PageShell>;
}

function Num({id,label,value,min,max,onChange}:{id:string;label:string;value:number;min:number;max:number;onChange:(v:number)=>void}) { return <div><Label htmlFor={id}>{label}</Label><Input id={id} type="number" className="h-11" required min={min} max={max} value={value} onChange={(e)=>onChange(Number(e.target.value))} /></div>; }
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}) { return <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 text-sm">{label}<Switch checked={checked} onCheckedChange={onChange} /></label>; }