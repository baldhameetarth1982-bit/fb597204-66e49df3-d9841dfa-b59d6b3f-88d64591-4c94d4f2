import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, TrendingUp, TrendingDown, Trash2, BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/ledger")({
  head: () => ({ meta: [{ title: "Ledger — SocioHub" }] }),
  component: () => (<FeatureGate feature="ledger"><AdminLedger /></FeatureGate>),
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
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "income" | "expense">("all");
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
      .limit(200);
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (!q) return true;
      return (e.description || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q);
    });
  }, [entries, query, kindFilter]);

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
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Accounts Center"
        title="Ledger"
        subtitle="Manual income & expense entries. Filter, search, add."
        icon={BookOpen}
        variant="teal"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
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
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add entry"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
        stats={
          <StatPillRow>
            <StatPill label="Income" value={fmt.format(totals.inc)} icon={TrendingUp} />
            <StatPill label="Expense" value={fmt.format(totals.exp)} icon={TrendingDown} />
            <StatPill label={totals.net >= 0 ? "Surplus" : "Deficit"} value={fmt.format(Math.abs(totals.net))} />
            <StatPill label="Entries" value={entries.length} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <AccountsCenterTabs />

        <SectionCard title="Filters">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search description or category" className="pl-9" />
            </div>
            <div className="flex gap-1.5">
              {(["all", "income", "expense"] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={kindFilter === k ? "default" : "outline"}
                  onClick={() => setKindFilter(k)}
                  className="rounded-full h-8 capitalize"
                >
                  {k}
                </Button>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard title={`Entries · ${visible.length}`} bodyClassName="p-0">
          {loading ? (
            <div className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={BookOpen} title="No entries" description="Add your first manual ledger entry to begin tracking." />
            </div>
          ) : (
            <ListCardGroup>
              {visible.map((e) => (
                <ListCard
                  key={e.id}
                  leading={
                    <span className={cn("h-10 w-10 rounded-xl grid place-items-center", e.kind === "income" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}>
                      {e.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    </span>
                  }
                  title={e.description || e.category || "—"}
                  subtitle={`${new Date(e.entry_date).toLocaleDateString()}${e.category ? ` · ${e.category}` : ""}`}
                  trailing={
                    <div className="flex items-center gap-1">
                      <span className={cn("text-sm font-semibold tabular-nums", e.kind === "income" ? "text-emerald-600" : "text-rose-600")}>
                        {e.kind === "income" ? "+" : "−"}{fmt.format(Number(e.amount))}
                      </span>
                      <Button size="icon" variant="ghost" onClick={() => remove(e.id)} className="h-8 w-8">
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
