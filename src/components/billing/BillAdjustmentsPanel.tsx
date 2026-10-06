import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addBillAdjustment, listBillAdjustments, type BillAdjustment } from "@/lib/bill-adjustments.functions";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/** Append-only adjustments. Mistakes are fixed with a counter entry — nothing is edited or deleted. */
export function BillAdjustmentsPanel({ societyId, billId, canAdjust }: { societyId: string; billId: string; canAdjust: boolean }) {
  const list = useServerFn(listBillAdjustments);
  const add = useServerFn(addBillAdjustment);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bill-adjustments", billId], queryFn: () => list({ data: { billId } }) });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reqId, setReqId] = useState(() => crypto.randomUUID());
  const parsed = /^\d{1,9}(\.\d{1,2})?$/.test(amount) ? Number(amount) : NaN;
  const valid = parsed > 0 && reason.trim().length >= 5;

  const m = useMutation({
    mutationFn: (v: { amount: number; reason: string; counterOf?: string; requestId: string }) =>
      add({ data: { societyId, billId, amount: v.amount, reason: v.reason, requestId: v.requestId, counterOf: v.counterOf ?? null } }),
    onSuccess: () => {
      toast.success(tu("op.adjustment_recorded"));
      setOpen(false); setAmount(""); setReason(""); setReqId(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: ["bill-adjustments", billId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const rows = q.data ?? [];
  const countered = new Set(rows.map((r) => r.counter_of).filter(Boolean));
  const net = rows.reduce((n, r) => n + r.amount, 0);

  const counter = (r: BillAdjustment) => m.mutate({ amount: -r.amount, reason: `Correction of earlier adjustment: ${r.reason}`.slice(0, 500), counterOf: r.id, requestId: `counter-${r.id}` });

  return <section className="rounded-2xl border p-4 space-y-3" aria-label={tu("op.adjustments")}>
    <div className="flex items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">{tu("op.adjustments")}</h3>
        <p className="text-xs text-muted-foreground">{tu("acc.net")} {INR.format(net)} · the bill itself is never edited</p></div>
      {canAdjust && !open && <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />{tu("vh.add")}</Button>}
    </div>
    {q.isError && <p className="text-sm text-destructive">{tu("op.adjustments_couldn_t_be_loaded")}</p>}
    {rows.length === 0 && !q.isLoading && !q.isError && <p className="text-sm text-muted-foreground">{tu("op.no_adjustments")}</p>}
    {rows.length > 0 && <ul className="divide-y text-sm">{rows.map((r) => <li key={r.id} className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0"><p className="break-words">{r.reason}</p><p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN")}{r.counter_of ? tu("op.correction_2") : ""}{countered.has(r.id) ? tu("op.corrected") : ""}</p></div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={`tabular-nums font-medium ${r.amount < 0 ? "text-primary" : ""}`}>{r.amount < 0 ? "−" : "+"}{INR.format(Math.abs(r.amount))}</span>
        {canAdjust && !r.counter_of && !countered.has(r.id) && <Button size="icon" variant="ghost" className="h-11 w-11" aria-label={tu("op.correct_this_adjustment")} disabled={m.isPending} onClick={() => counter(r)}><Undo2 className="h-4 w-4" /></Button>}
      </div>
    </li>)}</ul>}
    {open && <div className="space-y-3 rounded-xl bg-muted/40 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={kind === "credit" ? "default" : "outline"} className="min-h-11" onClick={() => setKind("credit")}>{tu("op.credit_reduce")}</Button>
        <Button type="button" variant={kind === "debit" ? "default" : "outline"} className="min-h-11" onClick={() => setKind("debit")}>{tu("op.charge_add")}</Button>
      </div>
      <div><Label htmlFor="adj-amt">{tu("acc.amountInr")}</Label><Input id="adj-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0.00" />
        {amount && !(parsed > 0) && <p className="mt-1 text-xs text-destructive">{tu("op.up_to_2_decimals_greater")}</p>}</div>
      <div><Label htmlFor="adj-reason">{tu("exp.reason")}</Label><Textarea id="adj-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button className="min-h-11" disabled={!valid || m.isPending} onClick={() => m.mutate({ amount: kind === "credit" ? -parsed : parsed, reason: reason.trim(), requestId: reqId })}>
          {m.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{tu("op.record")}</Button>
        <Button variant="ghost" className="min-h-11" onClick={() => setOpen(false)} disabled={m.isPending}>{tu("common.cancel")}</Button>
      </div>
    </div>}
  </section>;
}
