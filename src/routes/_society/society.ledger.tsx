import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
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
import { PageShell, PageHeader } from "@/components/shared/PageHeader";
import { FinanceTabs } from "@/components/shared/FinanceTabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/ledger")({
  head: () => ({ meta: [{ title: "Accounting — SocioHub" }] }),
  component: AdminLedger,
});

interface Entry {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  category: string | null;
  description: string | null;
  amount: number;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function AdminLedger() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    kind: "expense" as "income" | "expense",
    category: "",
    description: "",
    amount: "",
    entry_date: new Date().toISOString().slice(0, 10),
  });

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("ledger_entries")
      .select("id,entry_date,kind,category,description,amount")
      .eq("society_id", societyId)
      .order("entry_date", { ascending: false })
      .limit(100);
    setEntries((data as Entry[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [societyId]);

  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const e of entries) {
      const a = Number(e.amount);
      if (e.kind === "income") inc += a; else exp += a;
    }
    return { inc, exp, net: inc - exp };
  }, [entries]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !user) return;
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    setSubmitting(true);
    const { error } = await supabase.from("ledger_entries").insert({
      society_id: societyId,
      entry_date: form.entry_date,
      kind: form.kind,
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      amount: amt,
      created_by: user.id,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Entry added");
    setForm({ ...form, category: "", description: "", amount: "" });
    setOpen(false);
    void load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("ledger_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  return (
    <PageShell>
      <FinanceTabs />
      <PageHeader
        title="Accounting Ledger"
        description="Track income & expenses for your society"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl"><Plus className="h-4 w-4 mr-1" />
              New entry</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add ledger entry</DialogTitle></DialogHeader>
              <form onSubmit={add} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as "income" | "expense" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Maintenance, Security, Lift…" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Notes" />
                </div>
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
                </div>
                <Button type="submit" className="w-full rounded-xl" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card className="rounded-2xl bg-success/5 border-success/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-success"><TrendingUp className="h-4 w-4" /><span className="text-xs font-medium">Total Income</span></div>
            <p className="mt-1 text-2xl font-bold">{fmt.format(totals.inc)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl bg-destructive/5 border-destructive/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-destructive"><TrendingDown className="h-4 w-4" /><span className="text-xs font-medium">Total Expense</span></div>
            <p className="mt-1 text-2xl font-bold">{fmt.format(totals.exp)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">Net Balance</span>
            <p className={`mt-1 text-2xl font-bold ${totals.net >= 0 ? "text-success" : "text-destructive"}`}>{fmt.format(totals.net)}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center text-sm text-muted-foreground">No entries yet</CardContent></Card>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {entries.map((e) => (
                <li key={e.id} className="p-3 flex items-center gap-3">
                  <span className={`h-9 w-9 rounded-xl grid place-items-center ${e.kind === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {e.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.description || e.category || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(e.entry_date).toLocaleDateString()}{e.category ? ` · ${e.category}` : ""}</p>
                  </div>
                  <p className={`text-sm font-semibold ${e.kind === "income" ? "text-success" : "text-destructive"}`}>
                    {e.kind === "income" ? "+" : "−"}{fmt.format(Number(e.amount))}
                  </p>
                  <Button size="icon" variant="ghost" onClick={() => remove(e.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
