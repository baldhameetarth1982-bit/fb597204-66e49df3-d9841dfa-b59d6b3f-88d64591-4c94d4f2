import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FinanceTabs } from "@/components/shared/FinanceTabs";

export const Route = createFileRoute("/_society/society/expenses")({
  head: () => ({ meta: [{ title: "Expenses — SocioHub" }] }),
  component: ExpensesPage,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const CATEGORIES = [
  { value: "cleaning", label: "Cleaning" },
  { value: "security", label: "Security" },
  { value: "electricity", label: "Electricity" },
  { value: "water", label: "Water" },
  { value: "repair", label: "Repair" },
  { value: "salary", label: "Salary" },
  { value: "other", label: "Other" },
];

function ExpensesPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [category, setCategory] = useState("cleaning");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data } = await supabase.from("expenses").select("*")
        .eq("society_id", societyId!)
        .order("spent_on", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  async function add() {
    const n = Number(amount);
    if (!societyId || !n || n <= 0) return toast.error("Enter a valid amount");
    setSaving(true);
    const { error } = await supabase.from("expenses").insert({
      society_id: societyId, category, amount: n, note: note || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setAmount(""); setNote("");
    toast.success("Expense added");
    qc.invalidateQueries({ queryKey: ["expenses", societyId] });
    qc.invalidateQueries({ queryKey: ["society-finance", societyId] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["expenses", societyId] });
    qc.invalidateQueries({ queryKey: ["society-finance", societyId] });
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <FinanceTabs />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" /> Expenses
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Track society spending to see real profit/loss.</p>
      </header>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Add expense</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Amount (₹)</Label>
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <Button onClick={add} disabled={saving} className="sm:col-span-4 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Add expense
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Recent expenses</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            : (expenses ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No expenses yet.</p>
            : (
            <ul className="divide-y">
              {expenses!.map((e: any) => (
                <li key={e.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium capitalize">{e.category} · {INR.format(Number(e.amount))}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.spent_on).toLocaleDateString()} {e.note ? `· ${e.note}` : ""}</p>
                  </div>
                  <Button onClick={() => remove(e.id)} variant="ghost" size="icon" className="text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
