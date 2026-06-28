import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CalendarRange, Plus, Trash2, IndianRupee, FileText } from "lucide-react";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listSocietyMaintenance, seedCurrentMonthMaintenance, generateFlatBill,
} from "@/lib/maintenance.functions";

export const Route = createFileRoute("/_society/society/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — SocioHub" }] }),
  component: MaintenancePage,
});

type Period = {
  id: string; flat_id: string; period_label: string; period_start: string;
  amount_due: number; status: string; due_date: string | null;
  bill_id: string | null; paid_at: string | null;
};
type Flat = { id: string; flat_number: string; blocks: { name: string } | null };

const statusTone: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  outstanding: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  upcoming: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

function MaintenancePage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const list = useServerFn(listSocietyMaintenance);
  const seed = useServerFn(seedCurrentMonthMaintenance);
  const genBill = useServerFn(generateFlatBill);
  const qc = useQueryClient();

  const [seedAmount, setSeedAmount] = useState("2500");
  const [seeding, setSeeding] = useState(false);
  const [visible, setVisible] = useState(20);

  const { data, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-maintenance", societyId],
    queryFn: async () => list({ data: { societyId: societyId! } }),
    staleTime: 60_000,
  });
  const periods = (data?.periods ?? []) as Period[];
  const flats = (data?.flats ?? []) as Flat[];
  const reload = () => qc.invalidateQueries({ queryKey: ["society-maintenance", societyId] });

  // bill dialog
  const [billFlat, setBillFlat] = useState<Flat | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<{ description: string; amount: string }[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const byFlat = useMemo(() => {
    const m = new Map<string, Period[]>();
    for (const p of periods) {
      if (!m.has(p.flat_id)) m.set(p.flat_id, []);
      m.get(p.flat_id)!.push(p);
    }
    return m;
  }, [periods]);

  const flatLabel = (f: Flat) =>
    f.blocks?.name ? `${f.blocks.name} · ${f.flat_number}` : f.flat_number;

  function openBill(flat: Flat) {
    setBillFlat(flat);
    const open = (byFlat.get(flat.id) ?? []).filter(
      (p) => p.status !== "paid" && !p.bill_id,
    );
    setSelected(new Set(open.map((p) => p.id)));
    setExtras([]);
    setDueDate("");
    setNotes("");
  }

  async function handleSeed() {
    const amt = Number(seedAmount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    setSeeding(true);
    try {
      const { created } = await seed({ data: { societyId: societyId!, amount: amt } });
      toast.success(`Seeded ${created} flat(s) for this month`);
      reload();
    } catch (e: any) { toast.error(e.message); } finally { setSeeding(false); }
  }

  async function submitBill() {
    if (!billFlat) return;
    setCreating(true);
    try {
      const cleanExtras = extras
        .map((e) => ({ description: e.description.trim(), amount: Number(e.amount) }))
        .filter((e) => e.description && !Number.isNaN(e.amount) && e.amount >= 0);
      const { billId } = await genBill({
        data: {
          flatId: billFlat.id,
          periodIds: Array.from(selected),
          additional: cleanExtras,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
        },
      });
      toast.success("Bill generated");
      setBillFlat(null);
      reload();
      if (billId) window.location.href = `/society/billing#${billId}`;
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  }

  if (sidLoading || isLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Maintenance"
        description="Track every flat's monthly maintenance — independent of bills."
      />

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Seed this month</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="seed-amt">Monthly amount (₹)</Label>
            <Input id="seed-amt" inputMode="numeric" value={seedAmount}
              onChange={(e) => setSeedAmount(e.target.value)} />
          </div>
          <Button onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Apply to all flats
          </Button>
        </CardContent>
      </Card>

      {flats.length === 0 ? (
        <EmptyState icon={CalendarRange} title="No flats yet"
          description="Add blocks and flats to start tracking maintenance." />
      ) : (
        <div className="grid gap-3">
          {flats.slice(0, visible).map((f) => {
            const fp = byFlat.get(f.id) ?? [];
            const openCount = fp.filter((p) => p.status !== "paid" && !p.bill_id).length;
            const openAmt = fp
              .filter((p) => p.status !== "paid" && !p.bill_id)
              .reduce((s, p) => s + Number(p.amount_due), 0);
            return (
              <Card key={f.id} className="rounded-2xl">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{flatLabel(f)}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fp.length} period(s) · {openCount} unbilled · ₹{openAmt.toFixed(0)} pending
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openBill(f)} disabled={openCount === 0}>
                    <FileText className="h-4 w-4 mr-1.5" /> Generate Bill
                  </Button>
                </CardHeader>
                {fp.length > 0 && (
                  <CardContent className="flex flex-wrap gap-2">
                    {fp.slice(0, 12).map((p) => (
                      <Badge key={p.id} variant="outline"
                        className={`rounded-full ${statusTone[p.status] ?? ""}`}>
                        {p.period_label} · ₹{Number(p.amount_due).toFixed(0)} · {p.status}
                        {p.bill_id ? " · billed" : ""}
                      </Badge>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
          {visible < flats.length && (
            <Button variant="outline" className="rounded-2xl" onClick={() => setVisible((v) => v + 20)}>
              Show more ({flats.length - visible} remaining)
            </Button>
          )}
        </div>
      )}

      <Dialog open={!!billFlat} onOpenChange={(o) => !o && setBillFlat(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate bill · {billFlat ? flatLabel(billFlat) : ""}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Pending maintenance
              </Label>
              <div className="mt-2 space-y-1.5">
                {(byFlat.get(billFlat?.id ?? "") ?? [])
                  .filter((p) => p.status !== "paid" && !p.bill_id)
                  .map((p) => (
                    <label key={p.id}
                      className="flex items-center gap-3 rounded-xl border p-3 cursor-pointer">
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(p.id); else next.delete(p.id);
                          setSelected(next);
                        }}
                      />
                      <div className="flex-1 text-sm">{p.period_label}</div>
                      <div className="text-sm font-semibold">
                        <IndianRupee className="inline h-3.5 w-3.5" />{Number(p.amount_due).toFixed(0)}
                      </div>
                    </label>
                  ))}
                {(byFlat.get(billFlat?.id ?? "") ?? []).filter((p) => p.status !== "paid" && !p.bill_id).length === 0 && (
                  <p className="text-xs text-muted-foreground">No pending periods.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Additional charges
                </Label>
                <Button size="sm" variant="ghost"
                  onClick={() => setExtras((x) => [...x, { description: "", amount: "" }])}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {extras.map((e, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="Description (e.g. Water tanker)"
                      value={e.description}
                      onChange={(ev) => {
                        const n = [...extras]; n[i].description = ev.target.value; setExtras(n);
                      }} />
                    <Input type="number" inputMode="numeric" className="w-28" placeholder="₹"
                      value={e.amount}
                      onChange={(ev) => {
                        const n = [...extras]; n[i].amount = ev.target.value; setExtras(n);
                      }} />
                    <Button variant="ghost" size="icon"
                      onClick={() => setExtras(extras.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="due">Due date</Label>
                <Input id="due" type="date" value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBillFlat(null)}>Cancel</Button>
            <Button onClick={submitBill}
              disabled={creating || (selected.size === 0 && extras.length === 0)}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
