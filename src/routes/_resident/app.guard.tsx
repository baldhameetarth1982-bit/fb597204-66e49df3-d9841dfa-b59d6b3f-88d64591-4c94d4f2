import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogOut, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { requireBiometric } from "@/lib/biometric";

export const Route = createFileRoute("/_resident/app/guard")({
  head: () => ({ meta: [{ title: "Guard Dashboard — SocioHub" }] }),
  component: GuardDashboard,
});

interface VisitorRow {
  id: string;
  visitor_name: string;
  phone: string | null;
  flat_number: string | null;
  vehicle_number: string | null;
  purpose: string | null;
  entry_at: string;
  exit_at: string | null;
}

function GuardDashboard() {
  const { user, roles, isLoading } = useAuth();
  const { societyId } = useSocietyId();
  const [list, setList] = useState<VisitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    visitor_name: "",
    phone: "",
    flat_number: "",
    vehicle_number: "",
    purpose: "",
  });

  const allowed =
    roles.includes("security" as never) ||
    roles.includes("society_admin" as never) ||
    roles.includes("block_admin" as never);

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("visitors")
      .select("id, visitor_name, phone, flat_number, vehicle_number, purpose, entry_at, exit_at")
      .eq("society_id", societyId)
      .order("entry_at", { ascending: false })
      .limit(50);
    setList((data as VisitorRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId]);

  if (isLoading) return null;
  if (!allowed) return <Navigate to="/app/dashboard" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !user) return;
    if (!form.visitor_name.trim()) {
      toast.error("Visitor name required");
      return;
    }
    const approved = await requireBiometric("approve this visitor");
    if (!approved) return;
    setSubmitting(true);
    // Try to resolve flat_id from flat_number
    let flat_id: string | null = null;
    if (form.flat_number.trim()) {
      const { data: f } = await supabase
        .from("flats")
        .select("id")
        .eq("society_id", societyId)
        .eq("flat_number", form.flat_number.trim())
        .maybeSingle();
      flat_id = (f?.id as string) ?? null;
    }
    const { error } = await supabase.from("visitors").insert({
      society_id: societyId,
      flat_id,
      flat_number: form.flat_number.trim() || null,
      visitor_name: form.visitor_name.trim(),
      phone: form.phone.trim() || null,
      vehicle_number: form.vehicle_number.trim() || null,
      purpose: form.purpose.trim() || null,
      logged_by: user.id,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Visitor logged");
    setForm({ visitor_name: "", phone: "", flat_number: "", vehicle_number: "", purpose: "" });
    void load();
  }

  async function markExit(id: string) {
    const ok = await requireBiometric("approve visitor exit");
    if (!ok) return;
    const { error } = await supabase
      .from("visitors")
      .update({ exit_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Exit recorded");
    void load();
  }

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Guard Dashboard</h1>
        <p className="text-sm text-muted-foreground">Log visitors entering & leaving the gate</p>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Visitor name *</Label>
              <Input
                value={form.visitor_name}
                onChange={(e) => setForm({ ...form, visitor_name: e.target.value })}
                placeholder="Rahul Sharma"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="98xxxxxx"
                />
              </div>
              <div>
                <Label>Flat #</Label>
                <Input
                  value={form.flat_number}
                  onChange={(e) => setForm({ ...form, flat_number: e.target.value })}
                  placeholder="A-101"
                />
              </div>
            </div>
            <div>
              <Label>Vehicle number</Label>
              <Input
                value={form.vehicle_number}
                onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
                placeholder="MH 12 AB 1234"
              />
            </div>
            <div>
              <Label>Purpose</Label>
              <Input
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="Delivery / Guest / Service"
              />
            </div>
            <Button type="submit" className="w-full h-14 rounded-xl" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" />Approve visitor</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section>
        <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent gate log
        </h2>
        {loading ? (
          <div className="text-center text-muted-foreground py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : list.length === 0 ? (
          <Card className="rounded-2xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">No visitors yet</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {list.map((v) => (
              <Card key={v.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{v.visitor_name}</p>
                      {v.exit_at ? (
                        <Badge variant="secondary" className="rounded-full text-[10px]">Exited</Badge>
                      ) : (
                        <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Inside</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {v.flat_number || "—"} · {v.purpose || "Visit"}
                      {v.vehicle_number ? ` · ${v.vehicle_number}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      In: {new Date(v.entry_at).toLocaleString()}
                      {v.exit_at && ` · Out: ${new Date(v.exit_at).toLocaleString()}`}
                    </p>
                  </div>
                  {!v.exit_at && (
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => markExit(v.id)}>
                      <LogOut className="h-3.5 w-3.5 mr-1" /> Exit
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
