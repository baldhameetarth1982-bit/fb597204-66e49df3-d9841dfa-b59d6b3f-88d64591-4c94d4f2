import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Wallet, Loader2, Plus, Trash2, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/expenses")({
  head: () => ({ meta: [{ title: "Expenses — SocioHub" }] }),
  component: () => (<FeatureGate feature="expenses"><ExpensesPage /></FeatureGate>),
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

  const stats = useMemo(() => {
    const rows = (expenses ?? []) as any[];
    const total = rows.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const now = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTotal = rows.filter((e) => new Date(e.spent_on) >= mStart).reduce((s, e) => s + Number(e.amount ?? 0), 0);
    return { total, monthTotal, count: rows.length };
  }, [expenses]);

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
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Accounts Center"
        title="Expenses"
        subtitle="Track spend to see real surplus and deficit."
        icon={Wallet}
        variant="teal"
        stats={
          <StatPillRow>
            <StatPill label="Total spend" value={INR.format(stats.total)} icon={TrendingDown} />
            <StatPill label="This month" value={INR.format(stats.monthTotal)} />
            <StatPill label="Entries" value={stats.count} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <AccountsCenterTabs />

        <SectionCard title="Record an expense" description="Add a spend against your society">
          <div className="grid sm:grid-cols-4 gap-3">
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
          </div>
        </SectionCard>

        <SectionCard title="Recent expenses" description={`${(expenses ?? []).length} entries`} bodyClassName="p-0">
          {isLoading ? (
            <div className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (expenses ?? []).length === 0 ? (
            <div className="p-6"><EmptyState icon={Wallet} title="No expenses yet" description="Add your first spend above." /></div>
          ) : (
            <ListCardGroup>
              {(expenses as any[]).map((e) => (
                <ListCard
                  key={e.id}
                  leading={<span className="h-10 w-10 rounded-xl bg-rose-500/10 text-rose-600 grid place-items-center"><TrendingDown className="h-4 w-4" /></span>}
                  title={<span className="capitalize">{e.category}</span>}
                  subtitle={`${new Date(e.spent_on).toLocaleDateString()}${e.note ? ` · ${e.note}` : ""}`}
                  trailing={
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold tabular-nums text-rose-600">{INR.format(Number(e.amount))}</span>
                      <Button onClick={() => remove(e.id)} variant="ghost" size="icon" className="h-8 w-8">
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  }
                />
              ))}
            </ListCardGroup>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
