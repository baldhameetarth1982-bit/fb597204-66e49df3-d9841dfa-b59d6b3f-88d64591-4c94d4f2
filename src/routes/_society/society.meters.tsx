import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, AlertTriangle, Plus, Replace } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayIST } from "@/lib/overdue";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_society/society/meters")({
  head: () => ({
    meta: [
      { title: "Utility meters — SociyoHub" },
      { name: "description", content: "Register electricity, water and gas meters and record readings." },
      { property: "og:title", content: "Utility meters — SociyoHub" },
      { property: "og:description", content: "Meter readings, consumption and abnormal-reading alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MetersPage,
});

type Meter = { id: string; utility: string; meter_number: string; label: string | null; status: string; flat_id: string | null; installed_on: string };
type Reading = { id: string; meter_id: string; reading_date: string; reading: number; units: number; is_abnormal: boolean };
const UTILS = ["electricity", "water", "gas", "other"] as const;

function MetersPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [reg, setReg] = useState<{ replaces?: Meter } | null>(null);
  const [readFor, setReadFor] = useState<Meter | null>(null);

  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["meters", societyId],
    queryFn: async () => {
      const [m, f, r] = await Promise.all([
        supabase.from("utility_meters").select("id,utility,meter_number,label,status,flat_id,installed_on").eq("society_id", societyId!).order("created_at", { ascending: false }).limit(500),
        supabase.from("flats").select("id,flat_number").eq("society_id", societyId!).order("flat_number").limit(2000),
        supabase.from("utility_meter_readings").select("id,meter_id,reading_date,reading,units,is_abnormal").eq("society_id", societyId!).order("reading_date", { ascending: false }).limit(2000),
      ]);
      if (m.error) throw m.error; if (f.error) throw f.error; if (r.error) throw r.error;
      return { meters: m.data as Meter[], flats: f.data, readings: r.data as Reading[] };
    },
  });

  const flatName = useMemo(() => new Map((q.data?.flats ?? []).map((f) => [f.id, f.flat_number])), [q.data]);
  const latest = useMemo(() => {
    const map = new Map<string, Reading>();
    for (const r of q.data?.readings ?? []) if (!map.has(r.meter_id)) map.set(r.meter_id, r);
    return map;
  }, [q.data]);
  // India calendar month, compared as YYYY-MM-DD strings (a reading on the 1st counts).
  const monthStart = todayIST().slice(0, 8) + "01";
  const meters = (q.data?.meters ?? []).filter((m) => m.status === "active" && (filter === "all" || m.utility === filter));
  const missing = meters.filter((m) => { const l = latest.get(m.id); return !l || l.reading_date < monthStart; }).length;
  const abnormal = meters.filter((m) => latest.get(m.id)?.is_abnormal).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["meters", societyId] });

  return (
    <PageShell>
      <PageHeader title="Utility meters" description="Manual readings for electricity, water and gas. No provider is connected; readings are entered by the committee." />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Active meters" value={meters.length} />
        <Stat label="No reading this month" value={missing} />
        <Stat label="Abnormal last reading" value={abnormal} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["all", ...UTILS].map((u) => (
          <Button key={u} size="sm" variant={filter === u ? "default" : "outline"} onClick={() => setFilter(u)} className="min-h-11 capitalize">{u}</Button>
        ))}
        <Button className="ml-auto min-h-11" onClick={() => setReg({})}><Plus className="mr-1 h-4 w-4" />Add meter</Button>
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Loading meters…</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>Couldn't load meters.</p><Button variant="outline" className="mt-2" onClick={() => q.refetch()}>Try again</Button></div>
        : meters.length === 0 ? <div className="rounded-lg border p-8 text-center text-muted-foreground"><Gauge className="mx-auto mb-2 h-6 w-6" />No meters yet.</div>
        : (
          <ul className="divide-y rounded-lg border">
            {meters.map((m) => {
              const l = latest.get(m.id);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.meter_number} <span className="text-sm capitalize text-muted-foreground">· {m.utility}{m.flat_id ? ` · ${flatName.get(m.flat_id) ?? "Home"}` : " · Common"}</span></p>
                    <p className="text-sm text-muted-foreground">
                      {l ? <>Last {l.reading} on {l.reading_date} · {l.units} units</> : "No readings yet"}
                      {l?.is_abnormal && <span className="ml-2 inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />Unusual</span>}
                    </p>
                  </div>
                  <Button size="sm" className="min-h-11" onClick={() => setReadFor(m)}>Add reading</Button>
                  <Button size="sm" variant="outline" className="min-h-11" onClick={() => setReg({ replaces: m })}><Replace className="mr-1 h-4 w-4" />Replace</Button>
                </li>
              );
            })}
          </ul>
        )}
      {reg && societyId && <RegisterDialog societyId={societyId} replaces={reg.replaces} flats={q.data?.flats ?? []} onClose={() => setReg(null)} onDone={refresh} />}
      {readFor && <ReadingDialog meter={readFor} onClose={() => setReadFor(null)} onDone={refresh} />}
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>;
}

function RegisterDialog({ societyId, replaces, flats, onClose, onDone }: { societyId: string; replaces?: Meter; flats: { id: string; flat_number: string }[]; onClose: () => void; onDone: () => void }) {
  const [utility, setUtility] = useState(replaces?.utility ?? "electricity");
  const [num, setNum] = useState(""); const [flat, setFlat] = useState(replaces?.flat_id ?? ""); const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!num.trim() || busy) return; setBusy(true);
    const { error } = await supabase.rpc("admin_register_meter", { _society_id: societyId, _utility: utility, _meter_number: num, _flat_id: (flat || null) as string, _label: label, _replaces: (replaces?.id ?? null) as string });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(replaces ? "Meter replaced" : "Meter added"); onDone(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{replaces ? `Replace meter ${replaces.meter_number}` : "Add meter"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!replaces && <div><Label htmlFor="mu">Utility</Label>
            <select id="mu" className="mt-1 h-11 w-full rounded-md border bg-background px-2 capitalize" value={utility} onChange={(e) => setUtility(e.target.value)}>{UTILS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>}
          <div><Label htmlFor="mn">New meter number</Label><Input id="mn" maxLength={60} value={num} onChange={(e) => setNum(e.target.value)} /></div>
          {!replaces && <div><Label htmlFor="mf">Home (leave empty for common area)</Label>
            <select id="mf" className="mt-1 h-11 w-full rounded-md border bg-background px-2" value={flat} onChange={(e) => setFlat(e.target.value)}><option value="">Common area</option>{flats.map((f) => <option key={f.id} value={f.id}>{f.flat_number}</option>)}</select></div>}
          <div><Label htmlFor="ml">Label (optional)</Label><Input id="ml" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !num.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadingDialog({ meter, onClose, onDone }: { meter: Meter; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [val, setVal] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(val); if (!val || !Number.isFinite(n) || n < 0 || busy) return toast.error("Enter a valid reading");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_record_meter_reading", { _meter_id: meter.id, _reading_date: date, _reading: n, _note: note });
    setBusy(false);
    if (error) return toast.error(error.message);
    const r = data as { units: number; abnormal: boolean };
    r.abnormal ? toast.warning(`Saved: ${r.units} units — unusual compared with recent readings`) : toast.success(`Saved: ${r.units} units`);
    onDone(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reading for {meter.meter_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="rd">Reading date</Label><Input id="rd" type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label htmlFor="rv">Meter reading</Label><Input id="rv" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></div>
          <div><Label htmlFor="rn">Note (optional)</Label><Input id="rn" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Readings can't be edited later and must be newer and not lower than the last one.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save reading"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
