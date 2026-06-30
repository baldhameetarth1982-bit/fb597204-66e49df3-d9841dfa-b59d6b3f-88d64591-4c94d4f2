import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tags, Plus, Loader2, IndianRupee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/custom-plans")({
  head: () => ({ meta: [{ title: "Custom Plans — Super Admin" }] }),
  component: CustomPlansPage,
});

interface CustomPlan {
  id: string;
  society_id: string;
  name: string;
  price: number;
  duration_days: number;
  transaction_fee_pct: number;
  notes: string | null;
  status: string;
  created_at: string;
  society?: { name: string } | null;
}

interface SocietyOpt { id: string; name: string }

function CustomPlansPage() {
  const [rows, setRows] = useState<CustomPlan[]>([]);
  const [societies, setSocieties] = useState<SocietyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [societyId, setSocietyId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("30");
  const [feePct, setFeePct] = useState("1.5");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    const [{ data: plans }, { data: socs }] = await Promise.all([
      (supabase as any).from("custom_plans").select("*, society:societies(name)").order("created_at", { ascending: false }),
      supabase.from("societies").select("id,name").order("name"),
    ]);
    setRows((plans as any) ?? []);
    setSocieties((socs as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function createPlan() {
    if (!societyId || !name || !price) return toast.error("Fill society, name and price");
    setSaving(true);
    const { error } = await (supabase as any).from("custom_plans").insert({
      society_id: societyId,
      name,
      price: Number(price),
      duration_days: Number(duration),
      transaction_fee_pct: Number(feePct),
      notes: notes || null,
      status: "active",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Custom plan created");
    setOpen(false);
    setName(""); setPrice(""); setDuration("30"); setFeePct("1.5"); setNotes(""); setSocietyId("");
    void load();
  }

  async function grantToSociety(p: CustomPlan) {
    const { error } = await (supabase as any).rpc("admin_grant_society_plan", {
      _society_id: p.society_id,
      _duration_days: p.duration_days,
      _label: `Custom: ${p.name}`,
    });
    if (error) return toast.error(error.message);
    toast.success("Plan granted to society");
  }

  return (
    <div className="px-6 py-8 space-y-6 max-w-5xl">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Tags className="h-7 w-7 text-primary" /> Custom Plans
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build ad-hoc subscription tiers for specific societies — custom duration, price, and platform fee.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl"><Plus className="h-4 w-4 mr-1" /> New custom plan</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create custom plan</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Society</Label>
                <Select value={societyId} onValueChange={setSocietyId}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Pick a society" /></SelectTrigger>
                  <SelectContent>
                    {societies.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Plan name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium — 6 months" className="rounded-xl mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Price (₹)</Label>
                  <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-xl mt-1" />
                </div>
                <div>
                  <Label>Duration (days)</Label>
                  <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className="rounded-xl mt-1" />
                </div>
              </div>
              <div>
                <Label>Transaction fee (%)</Label>
                <Input type="number" step="0.1" value={feePct} onChange={(e) => setFeePct(e.target.value)} className="rounded-xl mt-1" />
              </div>
              <div>
                <Label>Internal notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={createPlan} disabled={saving} className="rounded-xl">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No custom plans yet. Create one to set a bespoke price/duration for a specific society.
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {rows.map((p) => (
            <Card key={p.id} className="rounded-2xl">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{p.society?.name ?? "—"}</div>
                    <div className="font-semibold text-lg">{p.name}</div>
                  </div>
                  <Badge variant="secondary" className="rounded-full">{p.status}</Badge>
                </div>
                <div className="flex items-baseline gap-1">
                  <IndianRupee className="h-4 w-4" />
                  <span className="text-2xl font-bold">{Number(p.price).toLocaleString("en-IN")}</span>
                  <span className="text-xs text-muted-foreground ml-1">/ {p.duration_days}d</span>
                </div>
                <div className="text-xs text-muted-foreground">Platform fee: {p.transaction_fee_pct}%</div>
                {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                <Button size="sm" className="rounded-xl w-full" onClick={() => grantToSociety(p)}>
                  Grant to society now
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
