import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Receipt, Loader2, Plus, IndianRupee, Search, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { shareBillAsImage } from "@/components/billing/BillCardImage";

export const Route = createFileRoute("/_society/society/billing")({
  head: () => ({ meta: [{ title: "Billing — SocioHub" }] }),
  component: BillingPage,
});

interface BillRow {
  id: string;
  period_label: string;
  amount: number;
  due_date: string;
  status: string;
  flat_id: string;
  flat: { flat_number: string; block: { name: string } | null } | null;
}

function BillingPage() {
  const { user } = useAuth();
  const { societyId, loading: sidLoading } = useSocietyId();
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  // Generate dialog state
  const [period, setPeriod] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [generating, setGenerating] = useState(false);

  // Cash / manual mark-paid removed — all payments are online (Razorpay)


  async function load() {
    if (!societyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("bills")
      .select("id, period_label, amount, due_date, status, flat_id")
      .eq("society_id", societyId)
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const bills = (data as any[]) ?? [];
    const flatIds = Array.from(new Set(bills.map((b) => b.flat_id).filter(Boolean)));
    let flatMap: Record<string, { flat_number: string; block_id: string | null }> = {};
    let blockMap: Record<string, string> = {};
    if (flatIds.length) {
      const { data: flats } = await supabase
        .from("flats")
        .select("id, flat_number, block_id")
        .in("id", flatIds);
      flatMap = Object.fromEntries((flats ?? []).map((f: any) => [f.id, { flat_number: f.flat_number, block_id: f.block_id }]));
      const blockIds = Array.from(new Set((flats ?? []).map((f: any) => f.block_id).filter(Boolean)));
      if (blockIds.length) {
        const { data: blocks } = await supabase.from("blocks").select("id, name").in("id", blockIds);
        blockMap = Object.fromEntries((blocks ?? []).map((b: any) => [b.id, b.name]));
      }
    }
    setRows(bills.map((b) => {
      const f = flatMap[b.flat_id];
      return {
        ...b,
        flat: f ? { flat_number: f.flat_number, block: f.block_id ? { name: blockMap[f.block_id] ?? "" } : null } : null,
      };
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [societyId]);

  async function generateBills() {
    if (!societyId) return;
    const amt = Number(amount);
    if (!period.trim() || !amt || !dueDate) {
      return toast.error("Fill all fields");
    }
    setGenerating(true);
    const { data: flats, error: fErr } = await supabase
      .from("flats")
      .select("id, block_id")
      .eq("society_id", societyId)
      .not("block_id", "is", null);
    if (fErr) {
      setGenerating(false);
      return toast.error(fErr.message);
    }
    if (!flats?.length) {
      setGenerating(false);
      return toast.error("Add blocks and assigned flats before generating bills.");
    }
    const { data: assigned } = await supabase
      .from("flat_residents")
      .select("flat_id")
      .in("flat_id", flats.map((f: any) => f.id));
    const assignedFlatIds = new Set((assigned ?? []).map((r: any) => r.flat_id));
    const billableFlats = flats.filter((f: any) => assignedFlatIds.has(f.id));
    if (!billableFlats.length) {
      setGenerating(false);
      return toast.error("Assign residents to flats before generating bills.");
    }
    const due = new Date(dueDate);
    const start = new Date(due.getFullYear(), due.getMonth(), 1)
      .toISOString().slice(0, 10);
    const end = new Date(due.getFullYear(), due.getMonth() + 1, 0)
      .toISOString().slice(0, 10);

    const payload = billableFlats.map((f: any) => ({
      society_id: societyId,
      flat_id: f.id,
      period_label: period.trim(),
      period_start: start,
      period_end: end,
      amount: amt,
      due_date: dueDate,
      status: "unpaid",
    }));
    const { error } = await supabase.from("bills").insert(payload);
    setGenerating(false);
    if (error) return toast.error(error.message);
    toast.success(`Generated ${payload.length} bills`);
    setOpen(false);
    setPeriod(""); setAmount(""); setDueDate("");
    void load();
  }

  // Manual "mark paid" removed — all settlements arrive automatically via Razorpay.


  async function markUnpaid(r: BillRow) {
    const { error } = await supabase.from("bills").update({ status: "unpaid" }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Marked unpaid");
    void load();
  }


  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      r.period_label.toLowerCase().includes(t) ||
      r.flat?.flat_number.toLowerCase().includes(t) ||
      r.flat?.block?.name?.toLowerCase().includes(t)
    );
  });

  if (sidLoading || loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Billing"
        description="Generate monthly maintenance bills and track payments."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl h-11">
                <Plus className="h-4 w-4 mr-2" /> Generate bills
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate monthly bills</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label>Period label</Label>
                  <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. June 2026" />
                </div>
                <div className="grid gap-2">
                  <Label>Amount per flat (₹)</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500" />
                </div>
                <div className="grid gap-2">
                  <Label>Due date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={generateBills} disabled={generating} className="rounded-xl">
                  {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Generate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills yet"
          description="Generate your first monthly maintenance bill for all flats."
        />
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by flat or period"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>
          <div className="rounded-2xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flat</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.flat?.block?.name ? `${r.flat.block.name}-` : ""}{r.flat?.flat_number ?? "—"}
                    </TableCell>
                    <TableCell>{r.period_label}</TableCell>
                    <TableCell>{new Date(r.due_date).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center"><IndianRupee className="h-3.5 w-3.5" />{Number(r.amount).toLocaleString("en-IN")}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "paid" ? "secondary" : "destructive"} className="rounded-md">
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        {/* Mark-paid removed: settlements are automatic via Razorpay */}

                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-lg h-8"
                          onClick={async () => {
                            try {
                              await shareBillAsImage({
                                societyName: "Society Bill",
                                flatLabel: `${r.flat?.block?.name ? r.flat.block.name + "-" : ""}${r.flat?.flat_number ?? ""}`,
                                period: r.period_label,
                                amount: Number(r.amount),
                                dueDate: new Date(r.due_date).toLocaleDateString(),
                                status: (r.status as any) || "due",
                                adminSignature: user?.email?.split("@")[0],
                              });
                            } catch (e: any) {
                              toast.error(e?.message ?? "Could not share");
                            }
                          }}
                        >
                          Share
                        </Button>
                        {r.status !== "paid" && r.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg h-8 text-destructive"
                            onClick={async () => {
                              const reason = window.prompt("Reason for cancellation?");
                              if (!reason) return;
                              const { error } = await supabase.rpc("cancel_bill", { _bill_id: r.id, _reason: reason });
                              if (error) toast.error(error.message);
                              else { toast.success("Bill cancelled"); load(); }
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Manual payment dialog removed — Razorpay settles automatically */}

    </PageShell>
  );
}
