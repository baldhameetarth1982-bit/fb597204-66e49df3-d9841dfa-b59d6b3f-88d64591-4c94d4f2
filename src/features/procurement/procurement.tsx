// Procurement & Budgets (Workstream 5). Every write goes through SECURITY DEFINER RPCs that resolve the
// society server-side, enforce finance permission, validate transitions/amounts and audit. Procurement
// records are references only: money is proven solely by a linked, posted Expense.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";

export const CATEGORIES = [["cleaning", "Cleaning"], ["security", "Security"], ["electricity", "Electricity"], ["repair", "Repair"], ["water", "Water"], ["salary", "Salary"], ["other", "Other"]] as const;
const catLabel = (c: string) => CATEGORIES.find((x) => x[0] === c)?.[1] ?? c;
export const inr = (n: number | null | undefined) => n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const currentFy = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
export const fyLabel = (y: number) => `FY ${y}–${String((y + 1) % 100).padStart(2, "0")}`;

/** Strict money parser: plain digits with up to 2 decimals. Rejects NaN, Infinity, exponents, negatives. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function procErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Try again when connected.";
  if (raw.includes("self_approval_denied")) return "You raised this request, so another committee member must approve it.";
  if (raw.includes("plan_required")) return "Procurement and budgets need the Growth plan or higher.";
  if (raw.includes("not_authorized") || raw.includes("42501") || raw.includes("unauthenticated")) return "You don't have permission to do that.";
  if (raw.includes("rate_limited")) return "Too many changes in a short time. Please wait a few minutes.";
  if (raw.includes("invalid_transition") || raw.includes("record_closed") || raw.includes("locked_after")) return "This request can't be changed at its current stage.";
  if (raw.includes("duplicate_quotation")) return "This vendor already has a quotation on this request.";
  if (raw.includes("invalid_vendor")) return "That vendor isn't in this society.";
  if (raw.includes("invalid_quotation")) return "Choose a quotation from this request.";
  if (raw.includes("expense_already_linked")) return "That expense is already linked to another request.";
  if (raw.includes("invalid_expense")) return "Choose a posted expense from this society.";
  if (raw.includes("invalid_amount")) return "Enter a positive amount with up to 2 decimals.";
  if (raw.includes("reason_required")) return "Please add a reason (at least 5 characters).";
  if (raw.includes("reference_required")) return "Please enter the reference.";
  if (raw.includes("invalid_date")) return "Choose a valid date (not in the future).";
  if (raw.includes("check") || raw.includes("23514") || raw.includes("22023")) return "Some details aren't valid. Check the fields and try again.";
  return "Something went wrong. Please try again.";
}

const STATUS: Record<string, [string, "muted" | "warn" | "bad" | "ok" | "info"]> = {
  draft: ["Draft", "muted"], quotation_pending: ["Quotation pending", "info"], awaiting_approval: ["Awaiting approval", "warn"],
  approved: ["Approved", "ok"], rejected: ["Rejected", "bad"], ordered: ["Ordered", "info"], invoice_received: ["Invoice received", "info"],
  payment_ref_recorded: ["Payment reference recorded", "info"], completed: ["Completed", "ok"], cancelled: ["Cancelled", "muted"],
};
export function Chip({ tone, children }: { tone: "muted" | "warn" | "bad" | "ok" | "info"; children: React.ReactNode }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
    tone === "bad" ? "bg-destructive/10 text-destructive" : tone === "warn" ? "bg-warning/15 text-warning-foreground" : tone === "ok" ? "bg-success/15 text-success" : tone === "info" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{children}</span>;
}
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
const mut = { networkMode: "always" as const, retry: false as const };

interface Req {
  id: string; request_no: number; title: string; description: string | null; category: string; fy_start: number; needed_by: string | null;
  estimated_amount: number | null; status: string; requested_by: string; selected_quotation_id: string | null; vendor_id: string | null;
  approved_amount: number | null; decision_note: string | null; order_ref: string | null; invoice_ref: string | null; invoice_amount: number | null;
  invoice_date: string | null; payment_ref: string | null; expense_id: string | null; cancel_reason: string | null; created_at: string;
}
interface Quote { id: string; request_id: string; vendor_id: string; amount: number; quote_ref: string | null; valid_until: string | null; notes: string | null }

const OPEN = ["draft", "quotation_pending", "awaiting_approval", "approved", "ordered", "invoice_received", "payment_ref_recorded"];
const isOverdue = (r: Req) => !!r.needed_by && OPEN.includes(r.status) && r.needed_by < new Date().toISOString().slice(0, 10);

export function PurchasesTab() {
  const { societyId: sid } = useSocietyId();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const q = useQuery({
    queryKey: ["procurement", sid], enabled: !!sid,
    queryFn: async () => {
      const [r, v, me, b] = await Promise.all([
        supabase.from("procurement_requests").select("*").eq("society_id", sid!).order("created_at", { ascending: false }).limit(200),
        supabase.from("finance_vendors").select("id, name, is_active").eq("society_id", sid!).order("name").limit(300),
        supabase.auth.getUser(),
        supabase.rpc("get_budget_vs_actual", { _fy_start: currentFy() }),
      ]);
      if (r.error) throw r.error;
      if (v.error) throw v.error;
      return { reqs: (r.data ?? []) as unknown as Req[], vendors: (v.data ?? []) as { id: string; name: string; is_active: boolean }[], me: me.data.user?.id ?? null,
        overBudget: new Set(((b.data ?? []) as { category: string; approved_amount: number | null; variance: number }[]).filter((x) => x.approved_amount != null && x.variance < 0).map((x) => x.category)) };
    },
  });
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <LoadError message={procErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const data = q.data!;
  const list = data.reqs.filter((r) => filter === "all" || OPEN.includes(r.status));
  const current = data.reqs.find((r) => r.id === open) ?? null;
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">A purchase record is not proof of payment. Money is only recorded when you post an Expense and link it here.</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Filter" className="flex gap-1 rounded-xl bg-muted p-1">
          {(["open", "all"] as const).map((k) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("min-h-10 rounded-lg px-3 text-sm", filter === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{k === "open" ? "Open" : "All"}</button>)}
        </div>
        <Button className="min-h-11" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />New request</Button>
      </div>
      {list.length === 0 ? <ListEmpty icon={ShoppingCart} title="No purchase requests" description="Raise a request to collect quotations and get committee approval." /> : (
        <ul className="space-y-2">
          {list.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, "muted"];
            return (
              <li key={r.id}>
                <button onClick={() => setOpen(r.id)} className="w-full min-h-11 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-medium">#{r.request_no} {r.title}</p>
                      <p className="text-xs text-muted-foreground">{catLabel(r.category)} · {fyLabel(r.fy_start)}{r.vendor_id ? ` · ${data.vendors.find((v) => v.id === r.vendor_id)?.name ?? "Vendor"}` : ""}</p></div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{inr(r.approved_amount ?? r.estimated_amount)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1"><Chip tone={tone}>{label}</Chip>
                    {isOverdue(r) && <Chip tone="bad">Overdue</Chip>}
                    {data.overBudget.has(r.category) && r.fy_start === currentFy() && OPEN.includes(r.status) && <Chip tone="warn">Over budget</Chip>}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <CreateSheet open={creating} onClose={() => setCreating(false)} />
      {current && <RequestSheet req={current} vendors={data.vendors} me={data.me} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", description: "", category: "repair", needed: "", estimate: "" });
  const m = useMutation({ ...mut,
    mutationFn: async () => {
      const est = f.estimate.trim() ? parseMoney(f.estimate) : null;
      if (f.estimate.trim() && est == null) throw new Error("invalid_amount");
      const { error } = await supabase.rpc("proc_create", { _title: f.title, _description: f.description, _category: f.category, _fy_start: currentFy(),
        _needed_by: (f.needed || null) as string, _estimated: est as number });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Request created as draft"); setF({ title: "", description: "", category: "repair", needed: "", estimate: "" }); onClose(); qc.invalidateQueries({ queryKey: ["procurement"] }); },
    onError: (e) => toast.error(procErrorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader><SheetTitle>New purchase request</SheetTitle></SheetHeader>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field id="p-title" label="What is needed"><Input id="p-title" required minLength={3} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field id="p-desc" label="Details (optional)"><Textarea id="p-desc" maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field id="p-cat" label="Budget category">
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger id="p-cat" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="p-need" label="Needed by"><Input id="p-need" type="date" value={f.needed} onChange={(e) => setF({ ...f, needed: e.target.value })} /></Field>
            <Field id="p-est" label="Estimate ₹ (optional)"><Input id="p-est" inputMode="decimal" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></Field>
          </div>
          <Button type="submit" className="min-h-11 w-full" disabled={m.isPending}>{m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save draft</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RequestSheet({ req, vendors, me, onClose }: { req: Req; vendors: { id: string; name: string; is_active: boolean }[]; me: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "—";
  const [text, setText] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(""); const [vendor, setVendor] = useState("");
  const [pick, setPick] = useState<string>(req.selected_quotation_id ?? ""); const [expense, setExpense] = useState("");
  const extra = useQuery({
    queryKey: ["procurement", "detail", req.id],
    queryFn: async () => {
      const [qq, ev, ex] = await Promise.all([
        supabase.from("procurement_quotations").select("id, request_id, vendor_id, amount, quote_ref, valid_until, notes").eq("request_id", req.id).order("amount"),
        supabase.from("procurement_events").select("id, from_status, to_status, note, created_at").eq("request_id", req.id).order("created_at"),
        ["invoice_received", "payment_ref_recorded"].includes(req.status)
          ? supabase.from("expenses").select("id, amount, spent_on, note, category").eq("society_id", req.society_id_placeholder ?? "").limit(0)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (qq.error) throw qq.error;
      return { quotes: (qq.data ?? []) as Quote[], events: (ev.data ?? []) as { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string }[], _ex: ex };
    },
  });
  const expenses = useQuery({
    queryKey: ["procurement", "expenses", req.id], enabled: ["invoice_received", "payment_ref_recorded"].includes(req.status),
    queryFn: async () => {
      const { data: row } = await supabase.from("procurement_requests").select("society_id").eq("id", req.id).maybeSingle();
      const { data, error } = await supabase.from("expenses").select("id, amount, spent_on, note, category").eq("society_id", row?.society_id ?? "").eq("status", "posted").order("spent_on", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as { id: string; amount: number; spent_on: string; note: string | null; category: string }[];
    },
  });
  const run = useMutation({ ...mut,
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => { const { error } = await fn(); if (error) throw error; },
    onSuccess: () => { toast.success("Saved"); setText(""); setAmount(""); setDate(""); qc.invalidateQueries({ queryKey: ["procurement"] }); },
    onError: (e) => toast.error(procErrorMessage(e)),
  });
  const money = (s: string) => { const n = parseMoney(s); if (n == null) { toast.error(procErrorMessage("invalid_amount")); } return n; };
  const [label, tone] = STATUS[req.status] ?? [req.status, "muted"];
  const busy = run.isPending;
  const quotes = extra.data?.quotes ?? [];
  const mine = me === req.requested_by;
  const canCancel = OPEN.slice(0, 5).includes(req.status);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader><SheetTitle className="pr-6">#{req.request_no} {req.title}</SheetTitle></SheetHeader>
        <div className="mt-2 flex flex-wrap gap-1"><Chip tone={tone}>{label}</Chip>{isOverdue(req) && <Chip tone="bad">Overdue</Chip>}</div>
        {req.description && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{req.description}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Category</dt><dd>{catLabel(req.category)} · {fyLabel(req.fy_start)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Vendor</dt><dd className="truncate">{vName(req.vendor_id)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Approved amount</dt><dd className="tabular-nums">{inr(req.approved_amount)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Order ref</dt><dd className="break-all">{req.order_ref ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Invoice</dt><dd className="break-all">{req.invoice_ref ? `${req.invoice_ref} · ${inr(req.invoice_amount)}` : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Payment ref (info only)</dt><dd className="break-all">{req.payment_ref ?? "—"}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted-foreground">Linked expense</dt><dd>{req.expense_id ? "Linked — see Expenses for the posted amount" : "Not linked"}</dd></div>
          {req.decision_note && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Decision note</dt><dd>{req.decision_note}</dd></div>}
          {req.cancel_reason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Cancel reason</dt><dd>{req.cancel_reason}</dd></div>}
        </dl>
        {req.invoice_amount != null && req.approved_amount != null && req.invoice_amount > req.approved_amount && <p className="mt-2 text-xs text-destructive">Invoice is higher than the approved amount.</p>}

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">Quotations</h3>
          {extra.isLoading ? <ListSkeleton /> : quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotations yet.</p> : (
            <ul className="space-y-1">
              {quotes.map((qt, i) => (
                <li key={qt.id}>
                  <label className={cn("flex min-h-11 items-center gap-2 rounded-xl border p-2 text-sm", req.selected_quotation_id === qt.id && "border-primary")}>
                    {req.status === "quotation_pending" && <input type="radio" name="pick" checked={pick === qt.id} onChange={() => setPick(qt.id)} aria-label={`Select ${vName(qt.vendor_id)}`} />}
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{vName(qt.vendor_id)}</span>
                      <span className="text-xs text-muted-foreground">{qt.quote_ref ?? "No ref"}{qt.valid_until ? ` · valid to ${qt.valid_until}` : ""}</span></span>
                    <span className="tabular-nums font-semibold">{inr(qt.amount)}</span>
                    {i === 0 && quotes.length > 1 && <Chip tone="ok">Lowest</Chip>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {["draft", "quotation_pending"].includes(req.status) && (
            <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); const n = money(amount); if (n == null || !vendor) return;
              run.mutate(() => supabase.rpc("proc_add_quotation", { _request: req.id, _vendor: vendor, _amount: n, _quote_ref: text, _valid_until: (date || null) as string, _notes: "" })); }}>
              <div className="col-span-2"><Select value={vendor} onValueChange={setVendor}><SelectTrigger className="min-h-11" aria-label="Vendor"><SelectValue placeholder="Choose vendor" /></SelectTrigger>
                <SelectContent>{vendors.filter((v) => v.is_active).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>
                {vendors.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Add vendors in Operations → Vendors first.</p>}</div>
              <Input aria-label="Quoted amount ₹" placeholder="Amount ₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Input aria-label="Quote reference" placeholder="Quote ref" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} />
              <Input aria-label="Valid until" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>Add quotation</Button>
            </form>
          )}
        </section>

        <section className="mt-4 space-y-2">
          {req.status === "draft" && <Button className="min-h-11 w-full" disabled={busy} onClick={() => run.mutate(() => supabase.rpc("proc_submit", { _request: req.id }))}>Submit for quotations</Button>}
          {req.status === "quotation_pending" && <Button className="min-h-11 w-full" disabled={busy || !pick} onClick={() => run.mutate(() => supabase.rpc("proc_request_approval", { _request: req.id, _quotation: pick }))}>Send selected quotation for approval</Button>}
          {req.status === "awaiting_approval" && (mine
            ? <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">You raised this request, so another committee member must approve or reject it.</p>
            : <div className="space-y-2"><Textarea aria-label="Decision note" placeholder="Note (required to reject)" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => run.mutate(() => supabase.rpc("proc_decide", { _request: req.id, _approve: false, _note: text }))}>Reject</Button>
                  <Button className="min-h-11" disabled={busy} onClick={() => run.mutate(() => supabase.rpc("proc_decide", { _request: req.id, _approve: true, _note: text }))}>Approve</Button>
                </div></div>)}
          {req.status === "approved" && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(() => supabase.rpc("proc_mark_ordered", { _request: req.id, _order_ref: text })); }}>
            <Input aria-label="Purchase order reference" placeholder="Order / PO reference" maxLength={80} required value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" className="min-h-11" disabled={busy}>Mark ordered</Button></form>}
          {req.status === "ordered" && <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); const n = money(amount); if (n == null) return;
            run.mutate(() => supabase.rpc("proc_record_invoice", { _request: req.id, _invoice_ref: text, _amount: n, _invoice_date: date })); }}>
            <Input aria-label="Invoice number" placeholder="Invoice no." maxLength={80} required value={text} onChange={(e) => setText(e.target.value)} />
            <Input aria-label="Invoice amount ₹" placeholder="Amount ₹" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input aria-label="Invoice date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            <Button type="submit" className="min-h-11" disabled={busy}>Record invoice</Button></form>}
          {req.status === "invoice_received" && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(() => supabase.rpc("proc_record_payment_ref", { _request: req.id, _payment_ref: text })); }}>
            <Input aria-label="Payment reference" placeholder="Bank / cheque ref (info only)" maxLength={80} required value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>Save ref</Button></form>}
          {["invoice_received", "payment_ref_recorded"].includes(req.status) && (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-medium">Link the posted expense</p>
              <p className="text-xs text-muted-foreground">Post the payment in Expenses first, then link it here to complete the request.</p>
              {expenses.isLoading ? <ListSkeleton /> : (expenses.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No posted expenses found.</p> : (
                <Select value={expense} onValueChange={setExpense}><SelectTrigger className="min-h-11" aria-label="Expense"><SelectValue placeholder="Choose expense" /></SelectTrigger>
                  <SelectContent>{(expenses.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{x.spent_on} · {catLabel(x.category)} · {inr(x.amount)}</SelectItem>)}</SelectContent></Select>)}
              {expense && req.invoice_amount != null && Number(expenses.data?.find((x) => x.id === expense)?.amount) !== Number(req.invoice_amount) && <p className="text-xs text-warning-foreground">Expense amount differs from the invoice.</p>}
              <Button className="min-h-11 w-full" disabled={busy || !expense} onClick={() => run.mutate(() => supabase.rpc("proc_link_expense", { _request: req.id, _expense: expense }))}>Link and complete</Button>
            </div>)}
          {canCancel && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm text-destructive">Cancel request</summary>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(() => supabase.rpc("proc_cancel", { _request: req.id, _reason: text })); }}>
              <Input aria-label="Cancel reason" placeholder="Reason" minLength={5} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" variant="destructive" className="min-h-11" disabled={busy}>Cancel</Button></form></details>}
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold">History</h3>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(extra.data?.events ?? []).map((e) => <li key={e.id}>{new Date(e.created_at).toLocaleString("en-IN")} · {STATUS[e.to_status]?.[0] ?? e.to_status}{e.note ? ` — ${e.note}` : ""}</li>)}
          </ol>
        </section>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Budgets ---------------- */
interface BudgetRow { category: string; budget_id: string | null; approved_amount: number | null; original_amount: number | null; revision_count: number; actual: number; variance: number; notes: string | null }

export function BudgetsPanel() {
  const { societyId: sid } = useSocietyId(); const qc = useQueryClient();
  const [fy, setFy] = useState(currentFy());
  const [edit, setEdit] = useState<BudgetRow | null>(null);
  const [f, setF] = useState({ amount: "", notes: "", reason: "" });
  const q = useQuery({
    queryKey: ["budgets", sid, fy], enabled: !!sid,
    queryFn: async () => { const { data, error } = await supabase.rpc("get_budget_vs_actual", { _fy_start: fy }); if (error) throw error; return (data ?? []) as BudgetRow[]; },
  });
  const hist = useQuery({
    queryKey: ["budgets", "rev", edit?.budget_id], enabled: !!edit?.budget_id,
    queryFn: async () => { const { data, error } = await supabase.from("society_budget_revisions").select("id, old_amount, new_amount, reason, created_at").eq("budget_id", edit!.budget_id!).order("created_at", { ascending: false }); if (error) throw error; return data ?? []; },
  });
  const save = useMutation({ ...mut,
    mutationFn: async () => {
      const n = parseMoney(f.amount); if (n == null) throw new Error("invalid_amount");
      const { error } = await supabase.rpc("budget_set", { _fy_start: fy, _category: edit!.category, _amount: n, _notes: f.notes, _reason: f.reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Budget saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["budgets"] }); qc.invalidateQueries({ queryKey: ["procurement"] }); },
    onError: (e) => toast.error(procErrorMessage(e)),
  });
  const rows = q.data ?? [];
  const tot = rows.reduce((a, r) => ({ b: a.b + Number(r.approved_amount ?? 0), a: a.a + Number(r.actual) }), { b: 0, a: 0 });
  const changing = edit?.approved_amount != null && parseMoney(f.amount) !== Number(edit.approved_amount);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}><SelectTrigger className="min-h-11 w-40" aria-label="Financial year"><SelectValue /></SelectTrigger>
          <SelectContent>{[0, 1, 2, -1].map((d) => currentFy() - d).map((y) => <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>)}</SelectContent></Select>
        <p className="text-xs text-muted-foreground">Actuals = posted Expenses (Apr–Mar)</p>
      </div>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <LoadError message={procErrorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Budget", tot.b], ["Actual", tot.a], ["Remaining", tot.b - tot.a]].map(([l, v]) => (
              <div key={l as string} className="rounded-2xl border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p>
                <p className={cn("truncate font-semibold tabular-nums", (v as number) < 0 && "text-destructive")}>{inr(v as number)}</p></div>))}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const pct = r.approved_amount ? Math.min(100, (Number(r.actual) / Number(r.approved_amount)) * 100) : 0;
              const over = r.approved_amount != null && r.variance < 0;
              return (
                <li key={r.category}>
                  <button className="w-full min-h-11 rounded-2xl border bg-card p-3 text-left hover:bg-muted/40" onClick={() => { setEdit(r); setF({ amount: r.approved_amount ? String(r.approved_amount) : "", notes: r.notes ?? "", reason: "" }); }}>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{catLabel(r.category)}</span>
                      <span className="flex gap-1">{r.revision_count > 0 && <Chip tone="info">Revised ×{r.revision_count}</Chip>}{over && <Chip tone="bad">Over budget</Chip>}{r.approved_amount == null && <Chip tone="muted">No budget</Chip>}</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full origin-left rounded-full", over ? "bg-destructive" : "bg-primary")} style={{ transform: `scaleX(${pct / 100})` }} /></div>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">Actual {inr(r.actual)} of {inr(r.approved_amount)}{r.approved_amount != null ? ` · ${over ? "over by" : "left"} ${inr(Math.abs(r.variance))}` : ""}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader><SheetTitle>{edit ? `${catLabel(edit.category)} · ${fyLabel(fy)}` : ""}</SheetTitle></SheetHeader>
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field id="b-amt" label="Approved budget ₹"><Input id="b-amt" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            {changing && <Field id="b-reason" label="Reason for revision"><Input id="b-reason" required minLength={5} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
            <Field id="b-notes" label="Notes (optional)"><Textarea id="b-notes" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <p className="text-xs text-muted-foreground">Changing a budget never changes recorded expenses. Every revision is kept.</p>
            <Button type="submit" className="min-h-11 w-full" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save budget</Button>
          </form>
          {edit?.budget_id && <section className="mt-4"><h3 className="text-sm font-semibold">Revision history</h3>
            <ol className="mt-2 space-y-1 text-xs text-muted-foreground">{(hist.data ?? []).map((h) => <li key={h.id}>{new Date(h.created_at).toLocaleDateString("en-IN")} · {h.old_amount == null ? "Set" : `${inr(h.old_amount)} →`} {inr(h.new_amount)}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ol></section>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------------- Auditor section ---------------- */
interface ReportRow { id: string; request_no: number; title: string; category: string; status: string; vendor_name: string | null; approved_amount: number | null; invoice_ref: string | null; invoice_amount: number | null; payment_ref: string | null; expense_id: string | null; expense_amount: number | null; expense_status: string | null }

export function ProcurementAuditSection({ fy }: { fy: number }) {
  const q = useQuery({
    queryKey: ["procurement-audit", fy],
    queryFn: async () => {
      const [b, p] = await Promise.all([supabase.rpc("get_budget_vs_actual", { _fy_start: fy }), supabase.rpc("get_procurement_report", { _fy_start: fy })]);
      if (b.error) throw b.error; if (p.error) throw p.error;
      return { budgets: (b.data ?? []) as BudgetRow[], procs: (p.data ?? []) as ReportRow[] };
    },
  });
  const csv = () => {
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const lines = [["Section", "Category/No", "Title", "Status", "Vendor", "Budget/Approved", "Actual/Invoice", "Variance/Invoice ref", "Payment ref (info)", "Linked expense", "Expense amount", "Expense status"].join(",")];
    q.data!.budgets.forEach((r) => lines.push(["Budget", r.category, "", r.revision_count ? `revised x${r.revision_count}` : "", "", r.approved_amount, r.actual, r.variance, "", "", "", ""].map(esc).join(",")));
    q.data!.procs.forEach((r) => lines.push(["Procurement", r.request_no, r.title, r.status, r.vendor_name, r.approved_amount, r.invoice_amount, r.invoice_ref, r.payment_ref, r.expense_id, r.expense_amount, r.expense_status].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `procurement-budget-${fy}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <p className="p-4 text-sm text-muted-foreground">{procErrorMessage(q.error)}</p>;
  const counts = q.data!.procs.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
  const b = q.data!.budgets.reduce((a, r) => ({ b: a.b + Number(r.approved_amount ?? 0), a: a.a + Number(r.actual) }), { b: 0, a: 0 });
  return (
    <div className="space-y-2 p-4 text-sm">
      <p>Budget {inr(b.b)} · Actual (posted expenses) {inr(b.a)} · Variance {inr(b.b - b.a)}</p>
      <p className="text-muted-foreground">{q.data!.procs.length === 0 ? "No purchase requests in this year." : Object.entries(counts).map(([k, v]) => `${STATUS[k]?.[0] ?? k}: ${v}`).join(" · ")}</p>
      <p className="text-xs text-muted-foreground">Payment references are informational; only linked posted expenses are financial records.</p>
      <Button variant="outline" className="min-h-11" onClick={csv}>Download CSV</Button>
    </div>
  );
}
