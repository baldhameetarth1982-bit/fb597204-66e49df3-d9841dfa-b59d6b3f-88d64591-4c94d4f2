import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommHeader, CommPage, SectionLabel } from "@/components/comm/CommUI";
import { ListEmpty, ListSkeleton, LoadError, StatusChip } from "@/components/people/PeopleUI";
import { supabase } from "@/integrations/supabase/client";
import {
  AMENITY_STATUS_LABELS,
  AMENITY_TYPE_LABELS,
  amenityError,
  localDateTime,
  type Amenity,
  type AmenityBooking,
  type AmenityStatus,
} from "@/lib/amenities";

export const Route = createFileRoute("/_resident/app/amenities")({
  head: () => ({ meta: [{ title: "Amenities — SociyoHub" }, { name: "description", content: "Book your society amenities and review your bookings." }] }),
  component: AmenitiesPage,
});

const statusTone = (status: AmenityStatus) => status === "confirmed" || status === "completed" ? "success" : status === "waitlisted" ? "warning" : "muted";

function AmenitiesPage() {
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [bookings, setBookings] = useState<AmenityBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Amenity | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [attendees, setAttendees] = useState(1);
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  async function load() {
    setLoading(true); setFailed(false);
    const [a, b] = await Promise.all([
      supabase.from("amenities").select("id,society_id,name,description,amenity_type,opens_at,closes_at,slot_minutes,capacity,advance_days,cancellation_hours,weekly_household_limit,owner_allowed,tenant_allowed,defaulters_allowed,deposit_amount,fee_amount,is_active").eq("is_active", true).order("name"),
      supabase.from("amenity_bookings").select("id,amenity_id,flat_id,starts_at,ends_at,attendees,status,cancellation_reason,amenities(name)").order("starts_at", { ascending: false }).limit(100),
    ]);
    if (a.error || b.error) setFailed(true);
    else { setAmenities((a.data ?? []) as Amenity[]); setBookings((b.data ?? []) as unknown as AmenityBooking[]); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const upcoming = useMemo(() => bookings.filter((b) => ["confirmed", "waitlisted"].includes(b.status) && new Date(b.ends_at) > new Date()), [bookings]);
  const history = useMemo(() => bookings.filter((b) => !upcoming.some((u) => u.id === b.id)), [bookings, upcoming]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !startsAt || saving) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("book_amenity", {
      _amenity_id: selected.id,
      _starts_at: new Date(startsAt).toISOString(),
      _attendees: attendees,
      _idempotency_key: requestKey,
    });
    setSaving(false);
    if (error) return toast.error(amenityError(error));
    const status = data?.[0]?.status;
    toast.success(status === "waitlisted" ? "Added to the waitlist" : "Booking confirmed");
    setSelected(null); setStartsAt(""); setAttendees(1); setRequestKey(crypto.randomUUID()); void load();
  }

  async function cancel(id: string) {
    const { error } = await supabase.rpc("cancel_amenity_booking", { _booking_id: id, _reason: "Cancelled by resident" });
    if (error) return toast.error(amenityError(error));
    toast.success("Booking cancelled"); void load();
  }

  const bookingList = (rows: AmenityBooking[], canCancel: boolean) => (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
      {rows.map((b) => <li key={b.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{b.amenities?.name ?? "Amenity"}</p><StatusChip tone={statusTone(b.status)}>{AMENITY_STATUS_LABELS[b.status]}</StatusChip></div>
          <p className="mt-1 text-sm text-muted-foreground">{localDateTime(b.starts_at)} · {b.attendees} {b.attendees === 1 ? "person" : "people"}</p>
        </div>
        {canCancel && <Button variant="outline" className="min-h-11" onClick={() => void cancel(b.id)}>Cancel</Button>}
      </li>)}
    </ul>
  );

  return <CommPage wide>
    <CommHeader title="Amenities" subtitle="Book shared spaces with clear capacity and waitlist status" />
    {loading ? <ListSkeleton rows={4} /> : failed ? <LoadError title="We couldn't load amenities." onRetry={() => void load()} /> : <>
      {amenities.length === 0 ? <ListEmpty icon={CalendarDays} title="No amenities available">Your committee has not opened any amenities for booking yet.</ListEmpty> :
        <section aria-labelledby="available-amenities"><SectionLabel id="available-amenities" count={amenities.length}>Available</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{amenities.map((a) => <article key={a.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">{a.name}</h2><p className="text-xs text-muted-foreground">{AMENITY_TYPE_LABELS[a.amenity_type]}</p></div><StatusChip tone="success">Open</StatusChip></div>
            {a.description && <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{a.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Hours</dt><dd className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{a.opens_at.slice(0,5)}–{a.closes_at.slice(0,5)}</dd></div><div><dt className="text-xs text-muted-foreground">Capacity</dt><dd className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{a.capacity}</dd></div></dl>
            <Button className="mt-4 min-h-11 w-full" onClick={() => { setSelected(a); setRequestKey(crypto.randomUUID()); }}>Book</Button>
          </article>)}</div></section>}
      {upcoming.length > 0 && <section><SectionLabel count={upcoming.length}>My upcoming bookings</SectionLabel>{bookingList(upcoming, true)}</section>}
      {history.length > 0 && <section><SectionLabel count={history.length}>History</SectionLabel>{bookingList(history, false)}</section>}
    </>}

    <Dialog open={!!selected} onOpenChange={(open) => !saving && !open && setSelected(null)}>
      <DialogContent><DialogHeader><DialogTitle>Book {selected?.name}</DialogTitle></DialogHeader>
        {selected && <form className="space-y-4" onSubmit={book}>
          <p className="text-sm text-muted-foreground">{selected.slot_minutes} minutes · up to {selected.capacity} people · book up to {selected.advance_days} days ahead.</p>
          <div className="space-y-1.5"><Label htmlFor="amenity-start">Start time</Label><Input id="amenity-start" type="datetime-local" className="h-11" required step={selected.slot_minutes * 60} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /><p className="text-xs text-muted-foreground">Choose a {selected.slot_minutes}-minute slot starting from {selected.opens_at.slice(0,5)}.</p></div>
          <div className="space-y-1.5"><Label htmlFor="amenity-attendees">People attending</Label><Input id="amenity-attendees" type="number" className="h-11" min={1} max={selected.capacity} required value={attendees} onChange={(e) => setAttendees(Number(e.target.value))} /></div>
          {(selected.fee_amount > 0 || selected.deposit_amount > 0) && <p className="rounded-xl bg-warning-container p-3 text-sm text-warning-container-foreground">Configured fee: ₹{selected.fee_amount}. Refundable deposit: ₹{selected.deposit_amount}. This booking does not collect or record a payment.</p>}
          <Button type="submit" className="h-12 w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm booking</Button>
        </form>}
      </DialogContent>
    </Dialog>
  </CommPage>;
}