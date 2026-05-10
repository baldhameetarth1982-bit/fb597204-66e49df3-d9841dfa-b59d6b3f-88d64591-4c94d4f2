import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Receipt, Plus, Loader2, Wallet, IndianRupee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/utils/format";

export const Route = createFileRoute("/_society/society/billing")({
  head: () => ({ meta: [{ title: "Billing — SocioHub" }] }),
  component: BillingPage,
});

interface Bill {
  id: string;
  flat_id: string;
  period_label: string;
  amount: number;
  due_date: string;
  status: string;
  flats: { flat_number: string; blocks: { name: string } | null } | null;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-success/10 text-success",
    unpaid: "bg-warning/10 text-warning",
    overdue: "bg-destructive/10 text-destructive",
    partial: "bg-primary/10 text-primary",
    cancelled: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${map[status] ?? "bg-secondary text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function BillingPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  // generation form
  const today = new Date();
  const defaultPeriod = today.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const [period, setPeriod] = useState(defaultPeriod);
  const [amount, setAmount] = useState("4500");
  const [dueDate, setDueDate] = useState(
    new Date(today.getFullYear(), today.getMonth() + 1, 10).toISOString().slice(0, 10),
  );

  // record payment form
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);

  async function fetchBills(sid: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("bills")
      .select("id, flat_id, period_label, amount, due_date, status, flats(flat_number, blocks(name))")
      .eq("society_id", sid)
      .order("due_date", { ascending: false });
    if (error) toast.error(error.message);
    setBills((data as unknown as Bill[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (societyId) void fetchBills(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId) return;
    setGenerating(true);
    const { data: flats, error: fErr } = await supabase
      .from("flats")
      .select("id")
      .eq("society_id", societyId);
    if (fErr || !flats?.length) {
      setGenerating(false);
      toast.error(fErr?.message ?? "No flats found. Add flats first.");
      return;
    }
    const start = new Date(dueDate);
    const periodStart = new Date(start.getFullYear(), start.getMonth() - 1, 1)
      .toISOString().slice(0, 10);
    const periodEnd = new Date(start.getFullYear(), start.getMonth(), 0)
      .toISOString().slice(0, 10);
    const rows = flats.map((f) => ({
      society_id: societyId,
      flat_id: f.id,
      period_label: period,
      period_start: periodStart,
      period_end: periodEnd,
      amount: parseFloat(amount),
      due_date: dueDate,
      status: "unpaid",
    }));
    const { error } = await supabase.from("bills").insert(rows);
    setGenerating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Generated ${rows.length} bills for ${period}`);
    setGenOpen(false);
    void fetchBills(societyId);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payBill || !societyId) return;
    setPaying(true);
    const amt = parseFloat(payAmount || String(payBill.amount));
    const { error: payErr } = await supabase.from("payments").insert({
      bill_id: payBill.id,
      society_id: societyId,
      flat_id: payBill.flat_id,
      amount: amt,
      method: payMethod,
      status: "success",
      reference_no: payRef || null,
    });
    if (payErr) {
      setPaying(false);
      toast.error(payErr.message);
      return;
    }
    const newStatus = amt >= payBill.amount ? "paid" : "partial";
    await supabase.from("bills").update({ status: newStatus }).eq("id", payBill.id);
    setPaying(false);
    toast.success("Payment recorded");
    setPayBill(null);
    setPayAmount("");
    setPayRef("");
    void fetchBills(societyId);
  }

  const stats = useMemo(() => {
    const total = bills.reduce((a, b) => a + Number(b.amount), 0);
    const collected = bills.filter((b) => b.status === "paid").reduce((a, b) => a + Number(b.amount), 0);
    const outstanding = total - collected;
    const defaulters = bills.filter((b) => b.status !== "paid" && new Date(b.due_date) < new Date()).length;
    return { total, collected, outstanding, defaulters };
  }, [bills]);

  const visible = filter === "all" ? bills : bills.filter((b) => b.status === filter);

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Billing" />
        <EmptyState
          icon={Receipt}
          title="Set up your society first"
          action={<Button asChild><a href="/onboarding">Set up</a></Button>}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Billing"
        description="Generate maintenance bills and record payments."
        actions={
          <Dialog open={genOpen} onOpenChange={setGenOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl">
                <Plus className="h-4 w-4 mr-2" /> Generate bills
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle>Generate maintenance bills</DialogTitle>
                <DialogDescription>
                  Creates one bill per flat for the period below.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleGenerate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="period">Period label</Label>
                  <Input id="period" value={period} onChange={(e) => setPeriod(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount per flat</Label>
                    <Input id="amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="due">Due date</Label>
                    <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={generating} className="rounded-xl">
                    {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Generate
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Wallet className="h-5 w-5 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{formatCurrency(stats.collected)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-warning/10 grid place-items-center">
              <IndianRupee className="h-5 w-5 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{formatCurrency(stats.outstanding)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Defaulters</CardTitle>
            <div className="h-10 w-10 rounded-xl bg-destructive/10 grid place-items-center">
              <Receipt className="h-5 w-5 text-destructive" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{stats.defaulters}</p>
          </CardContent>
        </Card>
      </section>

      <div className="mb-4 flex items-center gap-3">
        <Label className="text-xs text-muted-foreground">Filter</Label>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bills</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills yet"
          description="Generate your first bills to start collecting maintenance."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flat</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    {b.flats?.blocks?.name ? `${b.flats.blocks.name}-` : ""}{b.flats?.flat_number ?? "—"}
                  </TableCell>
                  <TableCell>{b.period_label}</TableCell>
                  <TableCell className="tabular-nums">{formatCurrency(Number(b.amount))}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(b.due_date)}</TableCell>
                  <TableCell><StatusPill status={b.status} /></TableCell>
                  <TableCell className="text-right">
                    {b.status !== "paid" && b.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="rounded-lg"
                        onClick={() => {
                          setPayBill(b);
                          setPayAmount(String(b.amount));
                        }}
                      >
                        Record payment
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!payBill} onOpenChange={(o) => !o && setPayBill(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {payBill && `${payBill.flats?.blocks?.name ?? ""}-${payBill.flats?.flat_number ?? ""} • ${payBill.period_label}`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pay-amt">Amount</Label>
              <Input id="pay-amt" type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="manual">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ref">Reference (optional)</Label>
              <Input id="ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Txn ID / receipt no." />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={paying} className="rounded-xl">
                {paying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
