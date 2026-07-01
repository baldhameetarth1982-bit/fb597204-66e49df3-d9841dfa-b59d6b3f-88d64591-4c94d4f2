import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, UserCheck, Plus, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/visitors")({
  head: () => ({ meta: [{ title: "Visitors — SocioHub" }] }),
  component: SocietyVisitors,
});

interface V {
  id: string; visitor_name: string; phone: string | null; vehicle_number: string | null;
  purpose: string | null; entry_at: string; exit_at: string | null; flat_number: string | null;
  status: string | null; pre_approved: boolean | null;
}

type Filter = "all" | "pending" | "inside" | "exited";

function computeStatus(v: V): Filter {
  if (v.exit_at) return "exited";
  if (v.status === "pending") return "pending";
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
  const [form, setForm] = useState({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" });

  async function load() {
    if (!societyId) return;
    const { data } = await supabase
      .from("visitors")
      .select("id, visitor_name, phone, vehicle_number, purpose, entry_at, exit_at, flat_number, status, pre_approved")
      .eq("society_id", societyId)
      .order("entry_at", { ascending: false })
      .limit(200);
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
    if (error) return toast.error(error.message);
    toast.success("Visitor logged");
    setForm({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", flat_number: "" });
    setOpen(false);
    void load();
  }

  async function approve(id: string) {
    const { error } = await supabase.from("visitors").update({ status: "approved" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Approved");
    void load();
  }
  async function reject(id: string) {
    const { error } = await supabase.from("visitors").update({ status: "rejected", exit_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }
  async function markExit(id: string) {
    const { error } = await supabase.from("visitors").update({ exit_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  if (sl || loading) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <PageShell>
      <PageHeader
        title="Visitors"
        description="Gate-pass log · auto-refreshes every 30s."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="rounded-xl h-11"><Plus className="h-4 w-4 mr-2" /> Log visitor</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Log a visitor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Visitor name</Label><Input value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                  <div><Label>Flat #</Label><Input value={form.flat_number} onChange={(e) => setForm({ ...form, flat_number: e.target.value })} placeholder="A-101" /></div>
                </div>
                <div><Label>Vehicle number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
                <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Delivery, guest…" /></div>
              </div>
              <DialogFooter><Button onClick={logVisitor} disabled={saving} className="rounded-xl">{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log entry</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="grid w-full grid-cols-4 rounded-2xl">
          <TabsTrigger value="all" className="rounded-xl">All ({list.length})</TabsTrigger>
          <TabsTrigger value="pending" className="rounded-xl">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="inside" className="rounded-xl">Inside ({counts.inside})</TabsTrigger>
          <TabsTrigger value="exited" className="rounded-xl">Exited ({counts.exited})</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyState icon={UserCheck} title="No visitors" description="Nothing matches this filter yet." />
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const s = computeStatus(v);
            return (
              <Card key={v.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">{v.visitor_name}</p>
                      {s === "pending" && <Badge className="rounded-full text-[10px] bg-amber-500 text-white">Pending</Badge>}
                      {s === "inside" && <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Inside</Badge>}
                      {s === "exited" && <Badge variant="secondary" className="rounded-full text-[10px]">Exited</Badge>}
                      {v.pre_approved && <Badge variant="outline" className="rounded-full text-[10px]">Pre-approved</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {v.purpose || "Visit"}{v.flat_number ? ` · Flat ${v.flat_number}` : ""}
                      {v.vehicle_number ? ` · ${v.vehicle_number}` : ""}{v.phone ? ` · ${v.phone}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      In: {new Date(v.entry_at).toLocaleString()}
                      {v.exit_at && ` · Out: ${new Date(v.exit_at).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {s === "pending" && (
                      <>
                        <Button size="sm" className="rounded-xl h-8" onClick={() => approve(v.id)}><Check className="h-3 w-3 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" className="rounded-xl h-8" onClick={() => reject(v.id)}><X className="h-3 w-3 mr-1" />Reject</Button>
                      </>
                    )}
                    {s === "inside" && (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => markExit(v.id)}>Mark exit</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
