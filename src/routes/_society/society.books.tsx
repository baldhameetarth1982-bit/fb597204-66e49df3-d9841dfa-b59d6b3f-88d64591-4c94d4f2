import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Lock, Plus, Scale, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSocietyId } from "@/hooks/useSocietyId";
import { downloadBlob } from "@/lib/auditor-pack";
import { listFinanceWorkspace } from "@/lib/finance-stage3d.functions";
import {
  GST_RATES, calculateExpenseTax, closeFinancialYear, createFinanceAccount, getBalanceSheet, getIncomeExpenditure, getTallyExport,
  getTaxReport, getTrialBalance, getYearStatus, listFinanceAccounts, listManualJournals, reopenFinancialYear, saveManualJournal,
  setSocietyTaxSettings, setVendorTax, transitionManualJournal, type BSSection, type IESection, type ManualJournal,
} from "@/lib/finance-books.functions";
import { buildLedgersCsv, buildTallyXml, buildTrialBalanceCsv, buildVouchersCsv, fyEndOf, fyLabel, fyStartOf, safeFilePart } from "@/lib/finance-books-export";

export const Route = createFileRoute("/_society/society/books")({
  head: () => ({ meta: [
    { title: "Books & Tax — SociyoHub" },
    { name: "description", content: "Manual journals, trial balance, income & expenditure, balance sheet, year close, Tally-ready export and GST/TDS." },
    { property: "og:title", content: "Books & Tax — SociyoHub" },
    { property: "og:description", content: "Formal society accounts built from the posted ledger." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <FeatureGate feature="accounts_center"><BooksPage /></FeatureGate>,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : INR.format(n));
const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
      <span className="flex-1">{errMsg(error)}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
const Loading = () => <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;

function PeriodPicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:max-w-md">
      <div><Label htmlFor="pf">From</Label><Input id="pf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div><Label htmlFor="pt">To</Label><Input id="pt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
    </div>
  );
}

function BooksPage() {
  const { societyId } = useSocietyId();
  const [from, setFrom] = useState(() => fyStartOf(today()));
  const [to, setTo] = useState(today);
  if (!societyId) return <Loading />;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <MobileHero eyebrow="Accounts Center" title="Books & Tax" subtitle="Formal statements from the posted ledger. Draft entries never count." icon={Scale} variant="teal" />
      <AccountsCenterTabs />
      <Tabs defaultValue="journals">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="mb-4 min-w-max">
            <TabsTrigger value="journals">Journals</TabsTrigger>
            <TabsTrigger value="tb">Trial balance</TabsTrigger>
            <TabsTrigger value="ie">Income &amp; Expenditure</TabsTrigger>
            <TabsTrigger value="bs">Balance sheet</TabsTrigger>
            <TabsTrigger value="close">Year close</TabsTrigger>
            <TabsTrigger value="tax">GST / TDS</TabsTrigger>
            <TabsTrigger value="export">Tally export</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="journals"><JournalsTab societyId={societyId} /></TabsContent>
        <TabsContent value="tb"><TrialBalanceTab societyId={societyId} from={from} to={to} setFrom={setFrom} setTo={setTo} /></TabsContent>
        <TabsContent value="ie"><IETab societyId={societyId} from={from} to={to} setFrom={setFrom} setTo={setTo} /></TabsContent>
        <TabsContent value="bs"><BSTab societyId={societyId} /></TabsContent>
        <TabsContent value="close"><YearCloseTab societyId={societyId} /></TabsContent>
        <TabsContent value="tax"><TaxTab societyId={societyId} from={from} to={to} setFrom={setFrom} setTo={setTo} /></TabsContent>
        <TabsContent value="export"><ExportTab societyId={societyId} from={from} to={to} setFrom={setFrom} setTo={setTo} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Journals ---------------- */

type DraftLine = { account_id: string; debit: string; credit: string; description: string };
const emptyLine = (): DraftLine => ({ account_id: "", debit: "", credit: "", description: "" });
const STATUS_LABEL: Record<ManualJournal["status"], string> = { draft: "Draft", in_review: "In review", posted: "Posted", reversed: "Reversal", cancelled: "Cancelled" };

function useAccounts(societyId: string) {
  const fn = useServerFn(listFinanceAccounts);
  return useQuery({ queryKey: ["fin-accounts", societyId], queryFn: () => fn({ data: { societyId } }), retry: false });
}

function JournalsTab({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listManualJournals);
  const saveFn = useServerFn(saveManualJournal);
  const transFn = useServerFn(transitionManualJournal);
  const accounts = useAccounts(societyId);
  const [status, setStatus] = useState<"all" | ManualJournal["status"]>("all");
  const [offset, setOffset] = useState(0);
  const list = useQuery({ queryKey: ["fin-journals", societyId, status, offset], queryFn: () => listFn({ data: { societyId, status, limit: 20, offset } }), retry: false, placeholderData: (p) => p });

  const [editing, setEditing] = useState<{ id: string | null; requestId: string } | null>(null);
  const [date, setDate] = useState(today);
  const [desc, setDesc] = useState("");
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const totals = useMemo(() => lines.reduce((a, l) => ({ dr: a.dr + (Number(l.debit) || 0), cr: a.cr + (Number(l.credit) || 0) }), { dr: 0, cr: 0 }), [lines]);
  const balanced = totals.dr > 0 && Math.round(totals.dr * 100) === Math.round(totals.cr * 100);

  const startNew = () => { setEditing({ id: null, requestId: crypto.randomUUID() }); setDate(today()); setDesc(""); setRef(""); setLines([emptyLine(), emptyLine()]); };
  const startEdit = (j: ManualJournal) => {
    setEditing({ id: j.id, requestId: crypto.randomUUID() }); setDate(j.transaction_date); setDesc(j.description); setRef(j.reference ?? "");
    setLines(j.lines.map((l) => ({ account_id: l.account_id, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", description: l.description ?? "" })));
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["fin-journals", societyId] }); qc.invalidateQueries({ queryKey: ["fin-tb", societyId] }); qc.invalidateQueries({ queryKey: ["fin-ie", societyId] }); qc.invalidateQueries({ queryKey: ["fin-bs", societyId] }); qc.invalidateQueries({ queryKey: ["fin-year", societyId] }); };

  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: () => saveFn({ data: { societyId, journalId: editing!.id, transactionDate: date, description: desc, reference: ref || undefined, requestId: editing!.requestId,
      lines: lines.map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || undefined })) } }),
    onSuccess: () => { toast.success("Draft saved"); setEditing(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const transition = useMutation({
    networkMode: "always", retry: false,
    mutationFn: (v: { journalId: string; action: "submit" | "post" | "cancel" | "reverse"; reason?: string }) => transFn({ data: { ...v, requestId: v.action === "reverse" ? crypto.randomUUID() : undefined } }),
    onSuccess: (r) => { toast.success(r.status === "posted" ? `Posted ${r.journal_no ?? ""}` : r.status === "reversed" ? "Reversal posted" : r.status === "cancelled" ? "Draft cancelled" : "Sent for review"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const askReason = (label: string) => { const r = window.prompt(label); return r && r.trim().length >= 5 ? r.trim() : null; };

  const lineValid = lines.every((l) => l.account_id && ((Number(l.debit) > 0) !== (Number(l.credit) > 0)));
  const canSave = editing && desc.trim().length >= 2 && lines.length >= 2 && lineValid && !save.isPending;

  return (
    <div className="space-y-4">
      <SectionCard title="Manual journals" description="Draft → review → post. Posted journals can only be corrected by a reversal." action={!editing && <Button onClick={startNew} disabled={!accounts.data}><Plus className="mr-1 h-4 w-4" />New journal</Button>}>
        {accounts.error && <ErrorBox error={accounts.error} onRetry={() => accounts.refetch()} />}
        {editing && accounts.data && (
          <form className="space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="jd">Date</Label><Input id="jd" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required /></div>
              <div className="sm:col-span-2"><Label htmlFor="jn">Narration</Label><Input id="jn" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} required /></div>
              <div className="sm:col-span-3"><Label htmlFor="jr">Reference / document no. (optional)</Label><Input id="jr" value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
                  <select aria-label={`Line ${i + 1} account`} className={`${selectCls} col-span-2 sm:col-span-1`} value={l.account_id} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, account_id: e.target.value } : x))}>
                    <option value="">Account…</option>
                    {accounts.data.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                  <Input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x))} />
                  <Input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x))} />
                  <Input aria-label={`Line ${i + 1} note`} placeholder="Line note" maxLength={200} value={l.description} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, description: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={lines.length >= 50} onClick={() => setLines([...lines, emptyLine()])}><Plus className="mr-1 h-4 w-4" />Add line</Button>
            </div>
            <div className={`flex flex-wrap justify-between gap-2 rounded-md p-2 text-sm ${balanced ? "bg-primary/5" : "bg-destructive/5"}`} aria-live="polite">
              <span>Debit {fmt(totals.dr)} · Credit {fmt(totals.cr)}</span>
              <span className="font-medium">{balanced ? "Balanced" : `Difference ${fmt(Math.abs(totals.dr - totals.cr))} — must balance before posting`}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!canSave}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save draft</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Discard changes</Button>
            </div>
          </form>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter journals">
        {(["all", "draft", "in_review", "posted", "reversed", "cancelled"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => { setStatus(s); setOffset(0); }}>{s === "all" ? "All" : STATUS_LABEL[s]}</Button>
        ))}
      </div>
      {list.error ? <ErrorBox error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <Loading /> : !list.data?.length ? (
        <EmptyState icon={Scale} title="No journals here" description="Manual journals you create will appear here." />
      ) : (
        <ul className="space-y-3">
          {list.data.map((j) => {
            const dr = j.lines.reduce((a, l) => a + l.debit, 0);
            const busy = transition.isPending && transition.variables?.journalId === j.id;
            return (
              <li key={j.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={j.status === "posted" ? "default" : j.status === "cancelled" ? "outline" : "secondary"}>{STATUS_LABEL[j.status]}</Badge>
                  {j.reversed_by_id && <Badge variant="outline">Reversed</Badge>}
                  <span className="font-medium">{j.journal_no ?? "Unnumbered draft"}</span>
                  <span className="text-sm text-muted-foreground">{j.transaction_date}</span>
                  <span className="ml-auto font-semibold tabular-nums">{fmt(dr)}</span>
                </div>
                <p className="mt-1 break-words text-sm">{j.description}{j.reference ? ` · Ref ${j.reference}` : ""}</p>
                {j.cancel_reason && <p className="text-xs text-muted-foreground">Cancelled: {j.cancel_reason}</p>}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <tbody>{j.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.code} · {l.name}</td><td className="py-1 text-right tabular-nums">{l.debit ? fmt(l.debit) : ""}</td><td className="py-1 text-right tabular-nums">{l.credit ? fmt(l.credit) : ""}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(j.status === "draft" || j.status === "in_review") && <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(j)}>Edit</Button>
                    {j.status === "draft" && <Button size="sm" variant="outline" disabled={busy} onClick={() => transition.mutate({ journalId: j.id, action: "submit" })}>Send for review</Button>}
                    <Button size="sm" disabled={busy} onClick={() => { if (window.confirm("Post this journal to the ledger? Posted entries cannot be edited.")) transition.mutate({ journalId: j.id, action: "post" }); }}>Post</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = askReason("Why cancel this draft? (min 5 characters)"); if (r) transition.mutate({ journalId: j.id, action: "cancel", reason: r }); }}>Cancel draft</Button>
                  </>}
                  {j.status === "posted" && j.source_action === "post" && !j.reversed_by_id && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = askReason("Reason for reversal (min 5 characters)"); if (r) transition.mutate({ journalId: j.id, action: "reverse", reason: r }); }}>Reverse</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
        <Button variant="outline" size="sm" disabled={(list.data?.length ?? 0) < 20} onClick={() => setOffset(offset + 20)}>Next</Button>
      </div>
      <AddAccountCard societyId={societyId} />
    </div>
  );
}

function AddAccountCard({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(createFinanceAccount);
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [type, setType] = useState<"asset" | "liability" | "equity" | "income" | "expense">("equity");
  const m = useMutation({ networkMode: "always", retry: false, mutationFn: () => fn({ data: { societyId, code, name, accountType: type } }),
    onSuccess: () => { toast.success("Account added"); setCode(""); setName(""); qc.invalidateQueries({ queryKey: ["fin-accounts", societyId] }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <SectionCard title="Add an account" description="For funds and reserves (e.g. Sinking Fund), deposits, TDS payable or GST input.">
      <form className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div><Label htmlFor="ac">Code</Label><Input id="ac" value={code} maxLength={24} placeholder="3100" onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        <div><Label htmlFor="an">Name</Label><Input id="an" value={name} maxLength={100} placeholder="Sinking Fund" onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="at">Type</Label><select id="at" className={selectCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Fund / reserve</option><option value="income">Income</option><option value="expense">Expense</option></select></div>
        <Button type="submit" disabled={m.isPending || !/^[A-Z0-9_-]{2,24}$/.test(code) || name.trim().length < 2}>Add</Button>
      </form>
    </SectionCard>
  );
}

/* ---------------- Statements ---------------- */

type PeriodProps = { societyId: string; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void };
const validRange = (from: string, to: string) => !!from && !!to && from <= to;

function BalanceCheck({ ok, label }: { ok: boolean; label: string }) {
  return <p className={`flex items-center gap-2 text-sm font-medium ${ok ? "text-primary" : "text-destructive"}`}>{ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{label}</p>;
}

function TrialBalanceTab({ societyId, from, to, setFrom, setTo }: PeriodProps) {
  const fn = useServerFn(getTrialBalance);
  const q = useQuery({ queryKey: ["fin-tb", societyId, from, to], enabled: validRange(from, to), queryFn: () => fn({ data: { societyId, from, to } }), retry: false, placeholderData: (p) => p });
  const t = q.data?.totals;
  return (
    <SectionCard title="Trial balance" description="Posted ledger only. Income and expense accounts open from the start of the financial year."
      action={q.data && <Button size="sm" variant="outline" onClick={() => downloadBlob(new Blob([buildTrialBalanceCsv(q.data!)], { type: "text/csv" }), `trial-balance-${from}-to-${to}.csv`)}><Download className="mr-1 h-4 w-4" />CSV</Button>}>
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-4 space-y-3">
          <BalanceCheck ok={t!.closing_debit === t!.closing_credit && t!.period_debit === t!.period_credit} label={t!.closing_debit === t!.closing_credit ? "Debits equal credits" : "Trial balance does not agree"} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground"><tr><th className="py-2">Account</th><th className="text-right">Opening</th><th className="text-right">Period Dr</th><th className="text-right">Period Cr</th><th className="text-right">Closing Dr</th><th className="text-right">Closing Cr</th></tr></thead>
              <tbody>
                {q.data.rows.filter((r) => r.opening_debit || r.opening_credit || r.period_debit || r.period_credit).map((r) => (
                  <tr key={r.code} className="border-t"><td className="py-1.5">{r.code} · {r.name}</td>
                    <td className="text-right tabular-nums">{r.opening_debit ? `${fmt(r.opening_debit)} Dr` : r.opening_credit ? `${fmt(r.opening_credit)} Cr` : "—"}</td>
                    <td className="text-right tabular-nums">{fmt(r.period_debit)}</td><td className="text-right tabular-nums">{fmt(r.period_credit)}</td>
                    <td className="text-right tabular-nums">{r.closing_debit ? fmt(r.closing_debit) : ""}</td><td className="text-right tabular-nums">{r.closing_credit ? fmt(r.closing_credit) : ""}</td></tr>
                ))}
                <tr className="border-t-2 font-semibold"><td className="py-2">Total</td><td /><td className="text-right tabular-nums">{fmt(t!.period_debit)}</td><td className="text-right tabular-nums">{fmt(t!.period_credit)}</td><td className="text-right tabular-nums">{fmt(t!.closing_debit)}</td><td className="text-right tabular-nums">{fmt(t!.closing_credit)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function AmountList({ title, rows, total }: { title: string; rows: { code: string; name: string; amount: number }[]; total: number }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No posted entries.</p> : (
        <ul className="divide-y text-sm">{rows.map((r) => <li key={r.code} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 break-words">{r.code} · {r.name}</span><span className="tabular-nums">{fmt(r.amount)}</span></li>)}</ul>
      )}
      <p className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold"><span>Total</span><span className="tabular-nums">{fmt(total)}</span></p>
    </div>
  );
}

function IESectionView({ s, label }: { s: IESection; label: string }) {
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">{label}: {s.from} to {s.to}</p>
      <AmountList title="Income" rows={s.income} total={s.total_income} />
      <AmountList title="Expenditure" rows={s.expenditure} total={s.total_expenditure} />
      <p className={`flex justify-between text-base font-semibold ${s.surplus >= 0 ? "text-primary" : "text-destructive"}`}><span>{s.surplus >= 0 ? "Surplus" : "Deficit"}</span><span className="tabular-nums">{fmt(Math.abs(s.surplus))}</span></p>
    </div>
  );
}

const shiftYear = (d: string, by: number) => `${Number(d.slice(0, 4)) + by}${d.slice(4)}`;

function IETab({ societyId, from, to, setFrom, setTo }: PeriodProps) {
  const fn = useServerFn(getIncomeExpenditure);
  const [cmp, setCmp] = useState(true);
  const q = useQuery({ queryKey: ["fin-ie", societyId, from, to, cmp], enabled: validRange(from, to),
    queryFn: () => fn({ data: { societyId, from, to, ...(cmp ? { cmpFrom: shiftYear(from, -1), cmpTo: shiftYear(to, -1) } : {}) } }), retry: false, placeholderData: (p) => p });
  return (
    <SectionCard title="Income & Expenditure statement" description="From posted income and expense accounts in the ledger.">
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} className="h-4 w-4" />Compare with the same period last year</label>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <IESectionView s={q.data.current} label="Current" />
          {q.data.comparative && <IESectionView s={q.data.comparative} label="Previous" />}
        </div>
      )}
    </SectionCard>
  );
}

function BSSectionView({ s }: { s: BSSection }) {
  const ok = Math.round(s.total_assets * 100) === Math.round((s.total_liabilities + s.total_funds) * 100);
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">As of {s.as_of}</p>
      <AmountList title="Assets" rows={s.assets} total={s.total_assets} />
      <AmountList title="Liabilities" rows={s.liabilities} total={s.total_liabilities} />
      <div>
        <AmountList title="Funds & reserves" rows={[...s.funds,
          { code: "SURPLUS-P", name: "Accumulated surplus — prior years", amount: s.prior_surplus },
          { code: "SURPLUS-C", name: "Surplus / (deficit) — current year", amount: s.current_surplus }]} total={s.total_funds} />
      </div>
      <BalanceCheck ok={ok} label={ok ? "Assets = Liabilities + Funds" : "Balance sheet does not agree"} />
    </div>
  );
}

function BSTab({ societyId }: { societyId: string }) {
  const fn = useServerFn(getBalanceSheet);
  const [asOf, setAsOf] = useState(today);
  const [cmp, setCmp] = useState(true);
  const cmpAsOf = fyEndOf(shiftYear(fyStartOf(asOf), -1));
  const q = useQuery({ queryKey: ["fin-bs", societyId, asOf, cmp], enabled: !!asOf, queryFn: () => fn({ data: { societyId, asOf, ...(cmp && cmpAsOf < asOf ? { cmpAsOf } : {}) } }), retry: false, placeholderData: (p) => p });
  return (
    <SectionCard title="Balance sheet" description="Posted ledger balances on the selected date.">
      <div className="sm:max-w-xs"><Label htmlFor="bsd">As of</Label><Input id="bsd" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} className="h-4 w-4" />Compare with previous year end ({cmpAsOf})</label>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-3 grid gap-4 md:grid-cols-2"><BSSectionView s={q.data.current} />{q.data.comparative && <BSSectionView s={q.data.comparative} />}</div>
      )}
    </SectionCard>
  );
}

/* ---------------- Year close ---------------- */

function YearCloseTab({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getYearStatus);
  const closeFn = useServerFn(closeFinancialYear);
  const reopenFn = useServerFn(reopenFinancialYear);
  const current = fyStartOf(today());
  const years = [0, 1, 2, 3].map((i) => shiftYear(current, -i));
  const [fy, setFy] = useState(years[1]);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["fin-year", societyId, fy], queryFn: () => statusFn({ data: { societyId, fyStart: fy } }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin-year", societyId] });
  const close = useMutation({ networkMode: "always", retry: false, mutationFn: () => closeFn({ data: { societyId, fyStart: fy, confirm } }),
    onSuccess: (r) => { toast.success(r.status === "already_closed" ? "This year was already closed" : `${fyLabel(fy)} closed`); setConfirm(""); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const reopen = useMutation({ networkMode: "always", retry: false, mutationFn: () => reopenFn({ data: { societyId, fyStart: fy, reason } }),
    onSuccess: () => { toast.success(`${fyLabel(fy)} reopened`); setReason(""); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const s = q.data;
  const blockers = s ? [
    ["Manual journals still in draft or review", s.blockers.manual_drafts],
    ["Verified payments not yet posted to the ledger", s.blockers.payments_unposted],
    ["Verified income not yet posted to the ledger", s.blockers.income_unposted],
    ["Expenses not yet posted", s.blockers.expenses_unposted],
  ] as const : [];
  const hasBlockers = !!s && (blockers.some(([, n]) => n > 0) || s.blockers.trial_balance_unbalanced);
  const phrase = `CLOSE ${fyLabel(fy)}`;
  return (
    <SectionCard title="Financial-year close" description="Closing locks the year: no posting can be dated inside it. History is never changed.">
      <div className="sm:max-w-xs"><Label htmlFor="fy">Financial year</Label>
        <select id="fy" className={selectCls} value={fy} onChange={(e) => { setFy(e.target.value); setConfirm(""); }}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></div>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !s ? <Loading /> : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {s.status === "closed" ? <Badge><Lock className="mr-1 h-3 w-3" />Closed</Badge> : <Badge variant="secondary"><Unlock className="mr-1 h-3 w-3" />Open</Badge>}
            <span className="text-sm text-muted-foreground">{s.fy_start} to {s.fy_end}</span>
            {s.closed_at && <span className="text-sm text-muted-foreground">Closed {new Date(s.closed_at).toLocaleString("en-IN")}</span>}
          </div>
          {s.reopen_reason && <p className="text-sm text-muted-foreground">Last reopened: {s.reopen_reason}</p>}
          <div>
            <h3 className="mb-1 text-sm font-semibold">Must be resolved before closing</h3>
            <ul className="space-y-1 text-sm">
              {blockers.map(([label, n]) => <li key={label} className="flex justify-between"><span>{label}</span><span className={n > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>{n}</span></li>)}
              <li className="flex justify-between"><span>Trial balance agrees</span><span className={s.blockers.trial_balance_unbalanced ? "font-semibold text-destructive" : "text-muted-foreground"}>{s.blockers.trial_balance_unbalanced ? "No" : "Yes"}</span></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Warnings (do not block closing)</h3>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>Bank statement lines not reconciled</span><span>{s.warnings.bank_lines_unreconciled}</span></li>
              <li className="flex justify-between"><span>Expenses with incomplete tax setup</span><span>{s.warnings.tax_needs_configuration}</span></li>
            </ul>
          </div>
          {s.status === "open" ? (
            !s.year_ended ? <p className="text-sm text-muted-foreground">This year has not ended yet, so it cannot be closed.</p> :
            <form className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
              <Label htmlFor="cc">Type <span className="font-mono">{phrase}</span> to confirm</Label>
              <Input id="cc" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              <Button type="submit" disabled={hasBlockers || confirm !== phrase || close.isPending}>{close.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Close {fyLabel(fy)}</Button>
              {hasBlockers && <p className="text-sm text-destructive">Resolve the blockers above first.</p>}
            </form>
          ) : (
            <form className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); reopen.mutate(); }}>
              <Label htmlFor="rr">Reason for reopening (recorded in the audit history)</Label>
              <Input id="rr" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" variant="outline" disabled={reason.trim().length < 10 || reopen.isPending}>Reopen year</Button>
            </form>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------- GST / TDS ---------------- */

function TaxTab({ societyId, from, to, setFrom, setTo }: PeriodProps) {
  const qc = useQueryClient();
  const reportFn = useServerFn(getTaxReport);
  const settingsFn = useServerFn(setSocietyTaxSettings);
  const vendorFn = useServerFn(setVendorTax);
  const calcFn = useServerFn(calculateExpenseTax);
  const vendorsFn = useServerFn(listFinanceWorkspace);
  const q = useQuery({ queryKey: ["fin-tax", societyId, from, to], enabled: validRange(from, to), queryFn: () => reportFn({ data: { societyId, from, to } }), retry: false, placeholderData: (p) => p });
  const vendors = useQuery({ queryKey: ["fin-vendors-tax", societyId], queryFn: () => vendorsFn({ data: { societyId, resource: "vendors", limit: 100, offset: 0 } }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin-tax", societyId] });

  const st = q.data?.settings;
  const [cfg, setCfg] = useState<{ gst: boolean; state: string; tds: boolean; tan: string } | null>(null);
  const c = cfg ?? (st ? { gst: st.gst_registered, state: st.gst_state_code ?? "", tds: st.tds_deductor, tan: st.tan ?? "" } : null);
  const saveCfg = useMutation({ networkMode: "always", retry: false, mutationFn: () => settingsFn({ data: { societyId, gstRegistered: c!.gst, gstStateCode: c!.state, tdsDeductor: c!.tds, tan: c!.tan } }),
    onSuccess: () => { toast.success("Tax settings saved"); setCfg(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  const [v, setV] = useState({ vendorId: "", gstin: "", pan: "", state: "", gstRate: "", tdsSection: "", tdsRate: "" });
  const saveVendor = useMutation({ networkMode: "always", retry: false,
    mutationFn: () => vendorFn({ data: { vendorId: v.vendorId, gstin: v.gstin, pan: v.pan, stateCode: v.state, gstRate: v.gstRate === "" ? null : Number(v.gstRate), tdsSection: v.tdsSection, tdsRate: v.tdsRate === "" ? null : Number(v.tdsRate) } }),
    onSuccess: () => { toast.success("Vendor tax profile saved"); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  const calc = useMutation({ networkMode: "always", retry: false,
    mutationFn: (expenseId: string) => calcFn({ data: { expenseId, includesGst: true, gstRate: null, supplyType: null, tdsSection: null, tdsRate: null } }),
    onSuccess: (r) => { r.status === "calculated" ? toast.success("Tax calculated") : toast.warning(`Needs setup: ${r.missing.join(", ").replace(/_/g, " ")}`); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border bg-muted/40 p-3 text-sm">
        SociyoHub calculates GST and TDS from the setup you enter here. It does <strong>not</strong> file returns or pay tax for you — confirm figures with your accountant before filing.
      </div>
      <SectionCard title="Society tax setup">
        {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !c ? <Loading /> : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveCfg.mutate(); }}>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.gst} onChange={(e) => setCfg({ ...c, gst: e.target.checked })} />Society is GST registered</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.tds} onChange={(e) => setCfg({ ...c, tds: e.target.checked })} />Society must deduct TDS</label>
            <div><Label htmlFor="ts">Society state code (2 digits)</Label><Input id="ts" inputMode="numeric" maxLength={2} value={c.state} onChange={(e) => setCfg({ ...c, state: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="tt">TAN (optional)</Label><Input id="tt" maxLength={10} value={c.tan} onChange={(e) => setCfg({ ...c, tan: e.target.value.toUpperCase() })} /></div>
            <Button type="submit" className="sm:col-span-2 sm:w-fit" disabled={saveCfg.isPending}>Save setup</Button>
          </form>
        )}
      </SectionCard>

      <SectionCard title="Vendor tax profile" description="Used to work out GST rate, in-state vs out-of-state supply, and TDS for that vendor's expenses.">
        {vendors.error ? <ErrorBox error={vendors.error} onRetry={() => vendors.refetch()} /> : (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (v.vendorId) saveVendor.mutate(); }}>
            <div className="sm:col-span-3"><Label htmlFor="vv">Vendor</Label>
              <select id="vv" className={selectCls} value={v.vendorId} onChange={(e) => setV({ ...v, vendorId: e.target.value })}>
                <option value="">Choose vendor…</option>
                {(vendors.data?.rows as { id: string; name: string }[] | undefined)?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
            <div><Label htmlFor="vg">GSTIN</Label><Input id="vg" maxLength={15} value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vp">PAN</Label><Input id="vp" maxLength={10} value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vs">State code</Label><Input id="vs" inputMode="numeric" maxLength={2} value={v.state} onChange={(e) => setV({ ...v, state: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="vr">GST rate</Label><select id="vr" className={selectCls} value={v.gstRate} onChange={(e) => setV({ ...v, gstRate: e.target.value })}>
              <option value="">Not set</option>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
            <div><Label htmlFor="vt">TDS section</Label><Input id="vt" maxLength={8} placeholder="194C" value={v.tdsSection} onChange={(e) => setV({ ...v, tdsSection: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vtr">TDS rate %</Label><Input id="vtr" inputMode="decimal" value={v.tdsRate} onChange={(e) => setV({ ...v, tdsRate: e.target.value })} /></div>
            <Button type="submit" className="sm:w-fit" disabled={!v.vendorId || saveVendor.isPending}>Save vendor profile</Button>
          </form>
        )}
      </SectionCard>

      <SectionCard title="Tax on posted expenses" description="Expense amounts are treated as invoice totals including GST. TDS is worked out on the value before GST.">
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {q.data && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[["Taxable value", q.data.totals.taxable], ["CGST", q.data.totals.cgst], ["SGST", q.data.totals.sgst], ["IGST", q.data.totals.igst], ["Total GST", q.data.totals.total_gst], ["TDS", q.data.totals.tds]].map(([l, n]) => (
                <div key={l as string} className="rounded-md border p-2"><p className="text-muted-foreground">{l}</p><p className="font-semibold tabular-nums">{fmt(n as number)}</p></div>
              ))}
              <div className="rounded-md border p-2"><p className="text-muted-foreground">Needs setup</p><p className="font-semibold">{q.data.totals.needs_configuration}</p></div>
              <div className="rounded-md border p-2"><p className="text-muted-foreground">Not calculated</p><p className="font-semibold">{q.data.totals.not_calculated}</p></div>
            </div>
            {q.data.rows.length === 0 ? <EmptyState icon={Scale} title="No posted expenses in this period" description="Posted expenses appear here for tax calculation." /> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-muted-foreground"><tr><th className="py-2">Date</th><th>Vendor / category</th><th className="text-right">Amount</th><th className="text-right">GST</th><th className="text-right">TDS</th><th className="text-right">Net payable</th><th>Status</th><th /></tr></thead>
                  <tbody>{q.data.rows.map((r) => (
                    <tr key={r.expense_id} className="border-t align-top">
                      <td className="py-1.5">{r.spent_on}</td><td>{r.vendor ?? "No vendor"} · {r.category}</td>
                      <td className="text-right tabular-nums">{fmt(r.amount)}</td>
                      <td className="text-right tabular-nums">{r.tax_status === "calculated" ? `${fmt(r.total_gst)}${r.gst_rate ? ` @${r.gst_rate}%` : ""}${r.supply_type === "inter" ? " IGST" : r.supply_type === "intra" ? " C+S" : ""}` : "—"}</td>
                      <td className="text-right tabular-nums">{r.tax_status === "calculated" ? (r.tds_amount ? `${fmt(r.tds_amount)} ${r.tds_section ?? ""}` : "None") : "—"}</td>
                      <td className="text-right tabular-nums">{fmt(r.net_payable)}</td>
                      <td>{r.tax_status === "calculated" ? <Badge>Calculated</Badge> : r.tax_status === "needs_configuration" ? <Badge variant="destructive" title={r.missing.join(", ")}>Needs setup: {r.missing.join(", ").replace(/_/g, " ")}</Badge> : <Badge variant="outline">Not calculated</Badge>}</td>
                      <td><Button size="sm" variant="outline" disabled={calc.isPending && calc.variables === r.expense_id} onClick={() => calc.mutate(r.expense_id)}>{r.tax_status === "not_calculated" ? "Calculate" : "Recalculate"}</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

/* ---------------- Tally export ---------------- */

function ExportTab({ societyId, from, to, setFrom, setTo }: PeriodProps) {
  const fn = useServerFn(getTallyExport);
  const [busy, setBusy] = useState<null | "xml" | "csv">(null);
  const run = async (kind: "xml" | "csv") => {
    if (!validRange(from, to)) { toast.error("Choose a valid date range."); return; }
    setBusy(kind);
    try {
      const data = await fn({ data: { societyId, from, to } });
      const base = `${safeFilePart(data.society ?? "society")}-${from}-to-${to}`;
      if (kind === "xml") downloadBlob(new Blob([buildTallyXml(data)], { type: "application/xml" }), `${base}-tally.xml`);
      else {
        downloadBlob(new Blob([buildVouchersCsv(data)], { type: "text/csv" }), `${base}-vouchers.csv`);
        downloadBlob(new Blob([buildLedgersCsv(data)], { type: "text/csv" }), `${base}-ledgers.csv`);
      }
      toast.success(`Exported ${data.vouchers.length} vouchers and ${data.ledgers.length} ledgers`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <SectionCard title="Tally-ready export" description="Ledgers with groups and opening balances, plus every posted voucher in the period. Built on your device; exporting never changes the books.">
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => run("xml")} disabled={!!busy}>{busy === "xml" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Tally XML</Button>
        <Button variant="outline" onClick={() => run("csv")} disabled={!!busy}>{busy === "csv" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}CSV (vouchers + ledgers)</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Designed for Tally import workflows; not an officially certified Tally integration. Check ledger names in Tally before importing.</p>
    </SectionCard>
  );
}
