import { PeopleAreaNav } from "@/components/people/PeopleUI";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, ParkingSquare, Search, Archive } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { gateErrorMessage } from "@/lib/visitors";

export const Route = createFileRoute("/_society/society/parking")({
  head: () => ({
    meta: [
      { title: "Parking — SociyoHub" },
      { name: "description", content: "Create parking slots and allot them to homes and vehicles." },
    ],
  }),
  component: () => (<FeatureGate feature="vehicles"><ParkingPage /></FeatureGate>),
});

interface Slot { id: string; label: string; slot_type: string; flat_id: string | null; vehicle_id: string | null; notes: string | null }
interface Flat { id: string; flat_number: string }
interface Veh { id: string; plate_number: string; flat_id: string | null }
const NONE = "__none";
const EMPTY = { id: null as string | null, label: "", slot_type: "car", flat_id: NONE, vehicle_id: NONE, notes: "" };

function ParkingPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const data = useQuery({
    queryKey: ["parking", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const [s, f, v] = await Promise.all([
        supabase.from("parking_slots").select("id, label, slot_type, flat_id, vehicle_id, notes").eq("society_id", societyId!).eq("is_active", true).order("label"),
        supabase.from("flats").select("id, flat_number").eq("society_id", societyId!).order("flat_number").limit(2000),
        supabase.from("vehicles").select("id, plate_number, flat_id").eq("society_id", societyId!).eq("is_active", true).limit(2000),
      ]);
      if (s.error) throw s.error;
      return { slots: (s.data ?? []) as Slot[], flats: (f.data ?? []) as Flat[], vehicles: (v.data ?? []) as Veh[] };
    },
  });

  const flatName = useMemo(() => new Map((data.data?.flats ?? []).map((f) => [f.id, f.flat_number])), [data.data]);
  const plate = useMemo(() => new Map((data.data?.vehicles ?? []).map((v) => [v.id, v.plate_number])), [data.data]);
  const slots = (data.data?.slots ?? []).filter((s) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [s.label, flatName.get(s.flat_id ?? ""), plate.get(s.vehicle_id ?? "")].some((x) => x?.toLowerCase().includes(t));
  });
  const assigned = (data.data?.slots ?? []).filter((s) => s.flat_id).length;
  const total = data.data?.slots.length ?? 0;
  const vehOptions = (data.data?.vehicles ?? []).filter((v) => form.flat_id === NONE || v.flat_id === form.flat_id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_parking_upsert", {
      _id: form.id as string, _label: form.label, _slot_type: form.slot_type,
      _flat_id: (form.flat_id === NONE ? null : form.flat_id) as string,
      _vehicle_id: (form.vehicle_id === NONE ? null : form.vehicle_id) as string, _notes: form.notes,
    });
    setSaving(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(form.id ? "Slot updated" : "Slot added");
    setOpen(false);
    setForm(EMPTY);
    qc.invalidateQueries({ queryKey: ["parking"] });
  }

  async function archive(id: string) {
    const { error } = await supabase.rpc("admin_parking_archive", { _id: id });
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Slot removed");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["parking"] });
  }

  return (
    <PageShell>
      <PeopleAreaNav />
      <PageHeader
        title="Parking"
        description={total ? `${assigned} of ${total} slots allotted` : "Create slots and allot them to homes"}
        actions={<Button className="rounded-xl min-h-11" onClick={() => { setForm(EMPTY); setOpen(true); }}><Plus className="h-4 w-4 mr-2" />Add slot</Button>}
      />
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search parking" className="pl-9 h-11 rounded-xl" placeholder="Slot, house or plate" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {data.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : data.isError ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">{gateErrorMessage(data.error)}</p>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => data.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : slots.length === 0 ? (
        <EmptyState icon={ParkingSquare} title={q ? "No matches" : "No parking slots yet"} description={q ? "Try another search." : "Add your first slot to start allotting parking."} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {slots.map((s) => (
            <li key={s.id}>
              <button className="w-full text-left" onClick={() => { setForm({ id: s.id, label: s.label, slot_type: s.slot_type, flat_id: s.flat_id ?? NONE, vehicle_id: s.vehicle_id ?? NONE, notes: s.notes ?? "" }); setOpen(true); }}>
                <Card className="rounded-2xl hover:bg-accent/40 transition-colors"><CardContent className="p-4 flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary grid place-items-center font-semibold text-sm">{s.label.slice(0, 4)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.label} <span className="text-xs font-normal text-muted-foreground capitalize">· {s.slot_type}</span></p>
                    <p className="text-sm text-muted-foreground truncate">
                      {s.flat_id ? `House ${flatName.get(s.flat_id) ?? "—"}` : "Free"}{s.vehicle_id ? ` · ${plate.get(s.vehicle_id) ?? ""}` : ""}
                    </p>
                  </div>
                </CardContent></Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{form.id ? "Edit slot" : "Add slot"}</SheetTitle></SheetHeader>
          <form onSubmit={save} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="p-label">Slot name *</Label><Input id="p-label" className="h-11" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value.toUpperCase() })} placeholder="P-12" maxLength={20} required /></div>
              <div><Label>Type</Label>
                <Select value={form.slot_type} onValueChange={(v) => setForm({ ...form, slot_type: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{["car", "bike", "visitor", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Allotted to house</Label>
              <Select value={form.flat_id} onValueChange={(v) => setForm({ ...form, flat_id: v, vehicle_id: NONE })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Not allotted</SelectItem>{(data.data?.flats ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.flat_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vehicle (optional)</Label>
              <Select value={form.vehicle_id} onValueChange={(v) => setForm({ ...form, vehicle_id: v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Any vehicle of the house</SelectItem>{vehOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="p-notes">Notes</Label><Input id="p-notes" className="h-11" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={200} placeholder="e.g. Basement 1" /></div>
            <Button type="submit" className="w-full h-12 rounded-xl" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
            {form.id && <Button type="button" variant="ghost" className="w-full min-h-11 text-destructive" onClick={() => archive(form.id!)}><Archive className="h-4 w-4 mr-2" />Remove slot</Button>}
          </form>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
