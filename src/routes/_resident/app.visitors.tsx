import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, QrCode, Share2, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/visitors")({
  head: () => ({ meta: [{ title: "My Visitors — SocioHub" }] }),
  component: MyVisitors,
});

interface VisitorRow {
  id: string;
  visitor_name: string;
  phone: string | null;
  vehicle_number: string | null;
  purpose: string | null;
  entry_at: string;
  exit_at: string | null;
  status: string | null;
  pre_approved: boolean | null;
  gate_pass_code: string | null;
  expected_at: string | null;
}

function StatusBadge({ v }: { v: VisitorRow }) {
  if (v.exit_at) return <Badge variant="secondary" className="rounded-full text-[10px]">Exited</Badge>;
  if (v.status === "pending") return <Badge className="rounded-full text-[10px] bg-amber-500 text-white">Pending</Badge>;
  if (v.status === "rejected") return <Badge variant="destructive" className="rounded-full text-[10px]">Rejected</Badge>;
  return <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Inside</Badge>;
}

function MyVisitors() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [list, setList] = useState<VisitorRow[]>([]);
  const [flatId, setFlatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", expected_at: "" });
  const [issued, setIssued] = useState<{ code: string; name: string } | null>(null);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data: fr } = await supabase
      .from("flat_residents").select("flat_id").eq("user_id", user.id);
    const flatIds = (fr ?? []).map((r) => r.flat_id as string);
    setFlatId(flatIds[0] ?? null);
    if (flatIds.length === 0) { setList([]); setLoading(false); return; }
    const { data } = await supabase
      .from("visitors")
      .select("id, visitor_name, phone, vehicle_number, purpose, entry_at, exit_at, status, pre_approved, gate_pass_code, expected_at")
      .in("flat_id", flatIds)
      .order("entry_at", { ascending: false })
      .limit(50);
    setList((data as VisitorRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [user?.id]);

  async function preApprove() {
    if (!societyId || !flatId) return toast.error("You must belong to a flat");
    if (!form.visitor_name.trim()) return toast.error("Visitor name required");
    setSaving(true);
    const { data, error } = await supabase.rpc("create_visitor_preapproval", {
      _society_id: societyId,
      _flat_id: flatId,
      _visitor_name: form.visitor_name.trim(),
      _phone: form.phone.trim() || "",
      _vehicle_number: form.vehicle_number.trim() || "",
      _purpose: form.purpose.trim() || "",
      _expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : new Date().toISOString(),
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    setIssued({ code: (row?.gate_pass_code as string) ?? "", name: form.visitor_name });
    setForm({ visitor_name: "", phone: "", vehicle_number: "", purpose: "", expected_at: "" });
    setOpen(false);
    void load();
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => toast.success("Code copied"));
  }

  async function shareCode() {
    if (!issued) return;
    const text = `SocioHub Gate Pass\nVisitor: ${issued.name}\nCode: ${issued.code}\nShow this code at the gate.`;
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* noop */ } }
    else { copyCode(text); }
  }

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Visitors</h1>
          <p className="text-sm text-muted-foreground">Pre-approve visitors with a one-time gate code</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Pre-approve</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Pre-approve a visitor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Visitor name *</Label><Input value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Expected at</Label><Input type="datetime-local" value={form.expected_at} onChange={(e) => setForm({ ...form, expected_at: e.target.value })} /></div>
              </div>
              <div><Label>Vehicle number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
              <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Delivery, guest…" /></div>
            </div>
            <DialogFooter><Button className="rounded-xl" onClick={preApprove} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Generate code</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {(() => {
        const seen = new Map<string, VisitorRow>();
        for (const v of list) {
          const key = (v.visitor_name || "").trim().toLowerCase();
          if (!key) continue;
          if (!seen.has(key)) seen.set(key, v);
          if (seen.size >= 6) break;
        }
        const freq = Array.from(seen.values());
        if (freq.length === 0) return null;
        return (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Frequent visitors — tap to pre-approve again</p>
            <div className="flex flex-wrap gap-1.5">
              {freq.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setForm({
                      visitor_name: v.visitor_name,
                      phone: v.phone ?? "",
                      vehicle_number: v.vehicle_number ?? "",
                      purpose: v.purpose ?? "",
                      expected_at: "",
                    });
                    setOpen(true);
                  }}
                  className="text-xs rounded-full bg-secondary hover:bg-secondary/80 px-3 py-1.5 font-medium"
                >
                  {v.visitor_name}
                </button>
              ))}
            </div>
          </div>
        );
      })()}


      {issued && (
        <Card className="rounded-2xl border-success/40 bg-success/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-xl bg-white p-2 shrink-0">
              <QRCodeSVG value={`SH|${issued.code}`} size={84} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Gate Pass</p>
              <p className="text-3xl font-bold tracking-widest">{issued.code}</p>
              <p className="text-xs text-muted-foreground truncate">For {issued.name}</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" className="rounded-lg" onClick={() => copyCode(issued.code)}><Copy className="h-3 w-3 mr-1" />Copy</Button>
                <Button size="sm" variant="outline" className="rounded-lg" onClick={shareCode}><Share2 className="h-3 w-3 mr-1" />Share</Button>
                <Button size="sm" variant="ghost" className="rounded-lg ml-auto" onClick={() => setIssued(null)}>Dismiss</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center text-sm text-muted-foreground">No visitors yet — tap Pre-approve to issue a gate pass.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {list.map((v) => (
            <Card key={v.id} className="rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate flex-1">{v.visitor_name}</p>
                  <StatusBadge v={v} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {v.purpose || "Visit"}{v.vehicle_number ? ` · ${v.vehicle_number}` : ""}{v.phone ? ` · ${v.phone}` : ""}
                </p>
                {v.status === "pending" && v.gate_pass_code ? (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono font-bold tracking-widest">{v.gate_pass_code}</span>
                    {v.expected_at && <span className="text-muted-foreground">· Expected {new Date(v.expected_at).toLocaleString()}</span>}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    In: {new Date(v.entry_at).toLocaleString()}
                    {v.exit_at && ` · Out: ${new Date(v.exit_at).toLocaleString()}`}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
