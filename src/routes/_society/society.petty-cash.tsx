import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Undo2, Download } from "lucide-react";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_society/society/petty-cash")({
  head: () => ({
    meta: [
      { title: "Petty cash — SociyoHub" },
      { name: "description", content: "Petty cash register with top-ups, small spends, vouchers and running balance." },
      { property: "og:title", content: "Petty cash — SociyoHub" },
      { property: "og:description", content: "Track the society's petty cash float with an audited register." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PettyCashPage,
});

type Entry = { id: string; entry_date: string; kind: "top_up" | "spend" | "reversal"; amount: number; purpose: string; voucher_no: string | null; paid_to: string | null; reverses: string | null; balance_after: number };
const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

function PettyCashPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [form, setForm] = useState<{ kind: "top_up" | "spend" | "reversal"; target?: Entry } | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [purpose, setPurpose] = useState("");
  const [voucher, setVoucher] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["petty-cash", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("petty_cash_entries")
        .select("id,entry_date,kind,amount,purpose,voucher_no,paid_to,reverses,balance_after")
        .eq("society_id", societyId!).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Entry[];
    },
  });
  const rows = q.data ?? [];
  const balance = rows[0]?.balance_after ?? 0;
  const reversed = new Set(rows.filter((r) => r.reverses).map((r) => r.reverses));
  const monthStart = today().slice(0, 8) + "01";
  const monthSpend = rows.filter((r) => r.kind === "spend" && r.entry_date >= monthStart && !reversed.has(r.id)).reduce((s, r) => s + Number(r.amount), 0);

  function open(kind: "top_up" | "spend" | "reversal", target?: Entry) {
    setForm({ kind, target }); setAmount(""); setDate(today()); setPurpose(""); setVoucher(""); setPaidTo(""); setRequestId(crypto.randomUUID());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !societyId || saving) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_petty_cash_entry", {
      _society_id: societyId, _kind: form.kind, _amount: form.kind === "reversal" ? 0 : Number(amount),
      _entry_date: date, _purpose: purpose, _voucher_no: voucher, _paid_to: paidTo,
      _reverses: form.target?.id ?? null as unknown as string, _request_id: requestId,
    });
    setSaving(false);
    if (error) return toast.error(error.message.includes("42501") || error.code === "42501" ? "You don't have permission to do that." : error.message);
    toast.success("Saved to the petty cash register");
    setForm(null);
    void qc.invalidateQueries({ queryKey: ["petty-cash", societyId] });
  }

  return (
    <PageShell>
      <PageHeader title="Petty cash" description="A register for the cash float kept for small expenses. Entries can't be edited; mistakes are corrected with a reversal. Book spends to accounts through Expenses as usual." />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Cash in hand</p><p className="text-xl font-semibold tabular-nums">{q.isSuccess ? inr(balance) : "—"}</p></div>
        <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Spent this month</p><p className="text-xl font-semibold tabular-nums">{q.isSuccess ? inr(monthSpend) : "—"}</p></div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => open("top_up")}><Plus className="mr-1 h-4 w-4" />Add cash</Button>
        <Button variant="outline" className="min-h-11" onClick={() => open("spend")}><Minus className="mr-1 h-4 w-4" />Record spend</Button>
        <Button variant="outline" className="min-h-11" disabled={!q.isSuccess || rows.length === 0} onClick={() => writeSafeWorkbook([...rows].reverse().map((r) => ({ Date: r.entry_date, Type: r.kind === "top_up" ? "Cash added" : r.kind === "spend" ? "Spend" : "Reversal", Purpose: r.purpose, Voucher: r.voucher_no ?? "", "Paid to": r.paid_to ?? "", "Amount (Rs.)": Number(r.amount), "Balance after (Rs.)": Number(r.balance_after), Status: reversed.has(r.id) ? "Reversed" : "" })), "Petty cash", `petty-cash-${today()}.xlsx`)}><Download className="mr-1 h-4 w-4" />Download register</Button>
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Loading register…</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>Couldn't load petty cash.</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>Try again</Button></div>
        : rows.length === 0 ? <p className="rounded-lg border p-6 text-center text-muted-foreground">No entries yet. Start with “Add cash”.</p>
        : <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.purpose}</p>
                <p className="text-xs text-muted-foreground">{r.entry_date}{r.voucher_no ? ` · Voucher ${r.voucher_no}` : ""}{r.paid_to ? ` · ${r.paid_to}` : ""}{reversed.has(r.id) ? " · Reversed" : ""}</p>
              </div>
              <div className="text-right">
                <p className={`font-semibold tabular-nums ${r.kind === "spend" ? "text-destructive" : "text-success"}`}>{r.kind === "spend" ? "−" : "+"}{inr(r.amount)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">Bal {inr(r.balance_after)}</p>
              </div>
              {r.kind !== "reversal" && !reversed.has(r.id) && (
                <Button size="sm" variant="ghost" className="min-h-11" aria-label="Reverse entry" onClick={() => open("reversal", r)}><Undo2 className="h-4 w-4" /></Button>
              )}
            </li>
          ))}
        </ul>}

      <Dialog open={!!form} onOpenChange={(o) => !saving && !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.kind === "top_up" ? "Add cash" : form?.kind === "spend" ? "Record spend" : "Reverse entry"}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            {form?.kind === "reversal" ? (
              <p className="text-sm text-muted-foreground">This adds a correcting entry for “{form.target?.purpose}” ({inr(form.target?.amount ?? 0)}). The original stays in the register.</p>
            ) : <>
              <div className="space-y-1.5"><Label htmlFor="pc-amt">Amount (₹)</Label><Input id="pc-amt" className="h-11" type="number" min="0.01" step="0.01" max="100000" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pc-date">Date</Label><Input id="pc-date" className="h-11" type="date" max={today()} required value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </>}
            <div className="space-y-1.5"><Label htmlFor="pc-purpose">{form?.kind === "reversal" ? "Reason" : "Purpose"}</Label><Input id="pc-purpose" className="h-11" minLength={3} maxLength={180} required value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
            {form?.kind === "spend" && <>
              <div className="space-y-1.5"><Label htmlFor="pc-v">Voucher no. (optional)</Label><Input id="pc-v" className="h-11" maxLength={40} value={voucher} onChange={(e) => setVoucher(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pc-to">Paid to (optional)</Label><Input id="pc-to" className="h-11" maxLength={80} value={paidTo} onChange={(e) => setPaidTo(e.target.value)} /></div>
            </>}
            <DialogFooter><Button type="submit" className="min-h-11 w-full" disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
