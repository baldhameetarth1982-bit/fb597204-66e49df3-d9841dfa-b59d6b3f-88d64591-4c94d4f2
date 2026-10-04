import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, Loader2, Plus, Printer, Receipt, Tags, TrendingUp } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { createIncomeWithBill, createCategorizedExpense, ensureDefaultAccountCategories, listExpenseCategories, listFinanceDocuments, saveExpenseCategory } from "@/lib/accounts-documents.functions";
import { indiaToday } from "@/lib/maintenance-status";
import { listIncomeCategoriesFn } from "@/lib/non-member-income.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/vouchers")({
  head: () => ({ meta: [
    { title: "Bills & Vouchers — SociyoHub" },
    { name: "description", content: "Numbered income bills and expense vouchers linked to the society's accounting records." },
    { property: "og:title", content: "Bills & Vouchers — SociyoHub" },
    { property: "og:description", content: "Income bills and expense vouchers tied to canonical accounting entries." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <FeatureGate feature="expenses"><VouchersPage /></FeatureGate>,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const KINDS = ["cleaning", "security", "electricity", "repair", "water", "salary", "other"] as const;
type Kind = (typeof KINDS)[number];

function VouchersPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const listCats = useServerFn(listExpenseCategories), seed = useServerFn(ensureDefaultAccountCategories), saveCat = useServerFn(saveExpenseCategory);
  const create = useServerFn(createCategorizedExpense), listDocs = useServerFn(listFinanceDocuments);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [offset, setOffset] = useState(0);
  const [categoryId, setCategoryId] = useState(""), [amount, setAmount] = useState(""), [desc, setDesc] = useState(""), [method, setMethod] = useState<"cash" | "bank_transfer">("bank_transfer"), [date, setDate] = useState(indiaToday());
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false);
  const [catOpen, setCatOpen] = useState(false), [editing, setEditing] = useState<{ id: string | null; name: string; kind: Kind; active: boolean }>({ id: null, name: "", kind: "other", active: true });
  const pageSize = 30;
  const listIncCats = useServerFn(listIncomeCategoriesFn), createBill = useServerFn(createIncomeWithBill);
  const incCats = useQuery({ queryKey: ["income-categories-select", societyId], enabled: !!societyId, retry: false, queryFn: () => listIncCats({ data: { societyId: societyId! } }) });
  const [bill, setBill] = useState({ categoryId: "", amount: "", method: "bank_transfer" as "cash" | "bank_transfer", date: indiaToday(), reference: "", desc: "" });
  const [billReq, setBillReq] = useState(() => crypto.randomUUID());
  const createIncomeBill = () => run(async () => {
    const value = Number(bill.amount);
    if (!societyId || !bill.categoryId) throw new Error("Choose a category");
    if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid amount");
    const r = await createBill({ data: { societyId, categoryId: bill.categoryId, amount: value, paymentMethod: bill.method, paymentDate: bill.date, reference: bill.reference || undefined, description: bill.desc || undefined, requestId: billReq } });
    setBillReq(crypto.randomUUID()); setBill((b) => ({ ...b, amount: "", reference: "", desc: "" }));
    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["income"] })]);
    toast.message(`Bill ${r.document_no} ${r.status === "existing" ? "already existed" : "issued"} — payment not yet verified`);
  }, "Income entry and bill saved");

  const cats = useQuery({ queryKey: ["expense-categories", societyId], enabled: !!societyId, retry: false, queryFn: () => listCats({ data: { societyId: societyId! } }) });
  const docs = useQuery({ queryKey: ["finance-documents", societyId, from, to, offset], enabled: !!societyId && !(from && to && from > to), retry: false, placeholderData: (p) => p,
    queryFn: () => listDocs({ data: { societyId: societyId!, from: from || null, to: to || null, limit: pageSize, offset } }) });
  const active = (cats.data?.rows ?? []).filter((c) => c.is_active);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(toSafeFinanceMessage(e)); } finally { setBusy(false); }
  }
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["expense-categories", societyId] }), qc.invalidateQueries({ queryKey: ["finance-documents", societyId] }), qc.invalidateQueries({ queryKey: ["finance-expenses", societyId] })]);

  const createVoucher = () => run(async () => {
    const value = Number(amount);
    if (!societyId || !categoryId) throw new Error("Choose a category");
    if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid amount");
    const r = await create({ data: { societyId, categoryId, vendorId: null, amount: value, expenseDate: date, paymentMethod: method, description: desc || undefined, requestId, withVoucher: true } });
    setRequestId(crypto.randomUUID()); setAmount(""); setDesc("");
    await refresh();
    return r;
  }, "Voucher created with its expense entry");

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow="Accounts Center" title="Bills & Vouchers" subtitle="Income → Bill. Expense → Voucher. Each document points to one accounting entry." icon={Receipt} variant="teal" />
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      <AccountsCenterTabs />

      <SectionCard icon={Tags} title="Expense categories" description="Society-only. Used categories are deactivated, never deleted."
        action={<div className="flex gap-2"><Button size="sm" variant="outline" className="min-h-11" disabled={busy || !societyId} onClick={() => run(async () => { await seed({ data: { societyId: societyId! } }); await refresh(); }, "Default categories ready")}>Add defaults</Button>
          <Button size="sm" className="min-h-11" onClick={() => { setEditing({ id: null, name: "", kind: "other", active: true }); setCatOpen(true); }}><Plus className="h-4 w-4 mr-1" />New</Button></div>} bodyClassName="p-0">
        {cats.isLoading ? <div className="p-8 grid place-items-center"><Loader2 className="animate-spin" /></div>
          : cats.error ? <div className="p-5 space-y-3"><p className="text-sm text-destructive" role="alert">Categories couldn't load.</p><Button size="sm" variant="outline" onClick={() => cats.refetch()}>Retry</Button></div>
          : !cats.data?.rows.length ? <div className="p-6"><EmptyState icon={Tags} title="No categories yet" description="Tap “Add defaults” for Water Bill, Electricity, Watchman and Cleaner." /></div>
          : <ListCardGroup>{cats.data.rows.map((c) => <ListCard key={c.id} title={c.name} subtitle={`${c.is_default ? "Default · " : ""}${c.is_active ? "Active" : "Inactive"}`}
              trailing={<Button size="sm" variant="outline" className="min-h-11" onClick={() => { setEditing({ id: c.id, name: c.name, kind: c.base_kind, active: c.is_active }); setCatOpen(true); }}>Edit</Button>} />)}</ListCardGroup>}
      </SectionCard>

      <SectionCard icon={FileText} title="New expense voucher" description="Creates the expense entry and its numbered voucher together.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => v === "__new" ? (setEditing({ id: null, name: "", kind: "other", active: true }), setCatOpen(true)) : setCategoryId(v)}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>{active.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}<SelectItem value="__new">+ Create new category</SelectItem></SelectContent>
            </Select></div>
          <div><Label>Paid by</Label><Select value={method} onValueChange={(v) => setMethod(v as typeof method)}><SelectTrigger aria-label="Paid by"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem></SelectContent></Select></div>
          <div><Label>Amount (₹)</Label><Input aria-label="Amount (₹)" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>Date</Label><Input aria-label="Date" type="date" max={indiaToday()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Description / reference</Label><Input aria-label="Description" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <Button className="sm:col-span-2 min-h-11" disabled={busy || !categoryId} onClick={() => { if (!busy) void createVoucher(); }}>{busy ? <Loader2 className="animate-spin mr-2" /> : <Plus className="mr-2" />}Create voucher</Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Income bills can also be issued from an income record on the Income page (“Issue bill”). Existing expenses get a voucher from the Expenses page.</p>
      </SectionCard>

      <SectionCard icon={TrendingUp} title="New income bill" description="Creates the income entry and its numbered bill together. The payment still needs verification on the Income page.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Income category</Label>
            <Select value={bill.categoryId} onValueChange={(v) => setBill({ ...bill, categoryId: v })}>
              <SelectTrigger aria-label="Income category"><SelectValue placeholder={incCats.error ? "Categories unavailable" : "Choose a category"} /></SelectTrigger>
              <SelectContent>{(incCats.data?.items ?? []).filter((c: any) => c.is_active).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>)}</SelectContent>
            </Select>
            <Link to="/society/income/categories" className="text-xs text-primary underline inline-flex items-center min-h-11">+ Create new category</Link></div>
          <div><Label>Received by</Label><Select value={bill.method} onValueChange={(v) => setBill({ ...bill, method: v as "cash" | "bank_transfer" })}><SelectTrigger aria-label="Received by"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem></SelectContent></Select></div>
          <div><Label>Amount (₹)</Label><Input aria-label="Income amount (₹)" type="number" inputMode="decimal" min="0.01" step="0.01" value={bill.amount} onChange={(e) => setBill({ ...bill, amount: e.target.value })} /></div>
          <div><Label>Date</Label><Input aria-label="Income date" type="date" max={indiaToday()} value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} /></div>
          <div><Label>Reference (optional)</Label><Input aria-label="Reference" maxLength={120} value={bill.reference} onChange={(e) => setBill({ ...bill, reference: e.target.value })} /></div>
          <div><Label>Description</Label><Input aria-label="Income description" maxLength={500} value={bill.desc} onChange={(e) => setBill({ ...bill, desc: e.target.value })} /></div>
          <Button className="sm:col-span-2 min-h-11" disabled={busy || !bill.categoryId} onClick={() => { if (!busy) void createIncomeBill(); }}>{busy ? <Loader2 className="animate-spin mr-2" /> : <Plus className="mr-2" />}Create income bill</Button>
        </div>
      </SectionCard>

      <SectionCard title="Issued documents" bodyClassName="p-0">
        <div className="grid grid-cols-2 gap-3 border-b p-3"><div><Label>From</Label><Input aria-label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} /></div><div><Label>To</Label><Input aria-label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} /></div></div>
        {docs.isLoading ? <div className="p-8 grid place-items-center"><Loader2 className="animate-spin" /></div>
          : docs.error ? <div className="p-5 space-y-3"><p className="text-sm text-destructive" role="alert">Documents couldn't load.</p><Button size="sm" variant="outline" onClick={() => docs.refetch()}>Retry</Button></div>
          : !docs.data?.rows.length ? <div className="p-6"><EmptyState icon={Receipt} title={from || to ? "No documents in this period" : "No bills or vouchers yet"} description="Issued bills and vouchers appear here." /></div>
          : <><ListCardGroup>{docs.data.rows.map((d) => {
              const e = d.expenses, i = d.society_income_records;
              const amt = d.kind === "voucher" ? e?.amount : i?.amount;
              const cat = d.kind === "voucher" ? e?.finance_expense_categories?.name ?? e?.note ?? "Expense" : i?.society_income_categories?.display_name ?? "Income";
              const state = d.kind === "voucher" ? (e?.status === "reversed" ? "Reversed" : "Posted") : (i?.verification_status === "verified" ? "Verified" : "Not yet verified");
              return <ListCard key={d.id} title={<span className="break-all">{d.document_no}</span>} subtitle={`${d.kind === "bill" ? "Income bill" : "Expense voucher"} · ${cat} · ${new Date(d.issued_at).toLocaleDateString("en-IN")}`} meta={state}
                trailing={<div className="flex items-center gap-2"><span className="font-semibold tabular-nums whitespace-nowrap">{amt != null ? INR.format(Number(amt)) : "—"}</span><Button asChild size="icon" variant="outline" className="h-11 w-11"><Link to="/society/document/$id" params={{ id: d.id }} aria-label={`Open ${d.document_no}`}><Printer className="h-4 w-4" /></Link></Button></div>} />;
            })}</ListCardGroup>
            <div className="flex items-center justify-between border-t p-3"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(0, v - pageSize))}>Previous</Button><span className="text-xs text-muted-foreground">{offset + 1}–{offset + docs.data.rows.length} of {docs.data.total}</span><Button size="sm" variant="outline" disabled={offset + docs.data.rows.length >= docs.data.total} onClick={() => setOffset((v) => v + pageSize)}>Next</Button></div></>}
      </SectionCard>
    </div>

    <Dialog open={catOpen} onOpenChange={setCatOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing.id ? "Edit category" : "New expense category"}</DialogTitle><DialogDescription>Past entries keep their category even if you rename or deactivate it.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Name</Label><Input aria-label="Category name" maxLength={60} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          <div><Label>Accounting group</Label><Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v as Kind })}><SelectTrigger aria-label="Accounting group"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}</SelectContent></Select></div>
          {editing.id && <div><Label>Status</Label><Select value={editing.active ? "on" : "off"} onValueChange={(v) => setEditing({ ...editing, active: v === "on" })}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="on">Active</SelectItem><SelectItem value="off">Inactive</SelectItem></SelectContent></Select></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCatOpen(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || editing.name.trim().length < 2} onClick={() => run(async () => { const r = await saveCat({ data: { societyId: societyId!, categoryId: editing.id, name: editing.name, baseKind: editing.kind, isActive: editing.id ? editing.active : null } }); if (!editing.id) setCategoryId(r.id); setCatOpen(false); await refresh(); }, "Category saved")}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
