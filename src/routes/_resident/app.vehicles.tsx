import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/vehicles")({
  head: () => ({ meta: [{ title: "My Vehicles — SociyoHub" }] }),
  component: VehiclesPage,
});

interface Vehicle {
  id: string;
  plate_number: string;
  make_model: string | null;
  color: string | null;
  type: string;
}

function VehiclesPage() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [list, setList] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ plate_number: "", make_model: "", color: "", type: "car" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("vehicles")
      .select("id, plate_number, make_model, color, type")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setList((data as Vehicle[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [user]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !societyId) {
      toast.error("Join a society first");
      return;
    }
    if (!form.plate_number.trim()) return toast.error("Plate number required");
    setSubmitting(true);
    const { error } = await supabase.from("vehicles").insert({
      user_id: user.id,
      society_id: societyId,
      plate_number: form.plate_number.trim().toUpperCase(),
      make_model: form.make_model.trim() || null,
      color: form.color.trim() || null,
      type: form.type,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Vehicle added");
    setForm({ plate_number: "", make_model: "", color: "", type: "car" });
    setOpen(false);
    void load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    void load();
  }

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Vehicles</h1>
          <p className="text-sm text-muted-foreground">So guards can verify you at the gate</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add vehicle</DialogTitle></DialogHeader>
            <form onSubmit={add} className="space-y-3">
              <div>
                <Label>Plate number *</Label>
                <Input value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} placeholder="MH 12 AB 1234" required />
              </div>
              <div>
                <Label>Make & model</Label>
                <Input value={form.make_model} onChange={(e) => setForm({ ...form, make_model: e.target.value })} placeholder="Honda City" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Color</Label>
                  <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="White" />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">Car</SelectItem>
                      <SelectItem value="bike">Bike</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center text-sm text-muted-foreground">No vehicles yet</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {list.map((v) => (
            <Card key={v.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-primary/10 grid place-items-center text-primary">
                  <Car className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold tracking-wide">{v.plate_number}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[v.make_model, v.color, v.type].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(v.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
