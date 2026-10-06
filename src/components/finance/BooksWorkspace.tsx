import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Lock, Plus, Scale, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
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
import { tu } from "@/lib/i18n";


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
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>{tu("common.tryAgain")}</Button>}
    </div>
  );
}
const Loading = () => <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tu("common.loading")}</div>;

function PeriodPicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:max-w-md">
      <div><Label htmlFor="pf">{tu("common.from")}</Label><Input id="pf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div><Label htmlFor="pt">To</Label><Input id="pt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
    </div>
  );
}

/** Read-only mode (Auditor): hides every write control. The server rejects writes regardless. */
export const BooksReadOnly = createContext(false);
const useRO = () => useContext(BooksReadOnly);

export function BooksPage({ readOnly = false }: { readOnly?: boolean }) {
  const { societyId } = useSocietyId();
  const [from, setFrom] = useState(() => fyStartOf(today()));
  const [to, setTo] = useState(today);
  if (!societyId) return <Loading />;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <BooksReadOnly.Provider value={readOnly}>
      {!readOnly && <MobileHero eyebrow={tu("accountsTabs.label")} title={tu("accountsTabs.books")} subtitle={tu("op.formal_statements_from_the_posted")} icon={Scale} variant="teal" />}
      {!readOnly && <AccountsCenterTabs />}
      <Tabs defaultValue="journals">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="mb-4 min-w-max">
            <TabsTrigger value="journals">{tu("op.journals")}</TabsTrigger>
            <TabsTrigger value="tb">{tu("op.trial_balance")}</TabsTrigger>
            <TabsTrigger value="ie">{tu("op.income_expenditure")}</TabsTrigger>
            <TabsTrigger value="bs">{tu("op.balance_sheet")}</TabsTrigger>
            <TabsTrigger value="close">{tu("op.year_close")}</TabsTrigger>
            <TabsTrigger value="tax">GST / TDS</TabsTrigger>
            <TabsTrigger value="export">{tu("op.tally_export")}</TabsTrigger>
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
      </BooksReadOnly.Provider>
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
  const ro = useRO();
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
    onSuccess: () => { toast.success(tu("op.draft_saved")); setEditing(null); refresh(); },
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
      <SectionCard title={tu("op.manual_journals")} description={tu("op.draft_review_post_posted_journals")} action={!editing && !ro && <Button onClick={startNew} disabled={!accounts.data}><Plus className="mr-1 h-4 w-4" />{tu("op.new_journal")}</Button>}>
        {accounts.error && <ErrorBox error={accounts.error} onRetry={() => accounts.refetch()} />}
        {editing && accounts.data && (
          <form className="space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label htmlFor="jd">{tu("common.date")}</Label><Input id="jd" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required /></div>
              <div className="sm:col-span-2"><Label htmlFor="jn">{tu("op.narration")}</Label><Input id="jn" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} required /></div>
              <div className="sm:col-span-3"><Label htmlFor="jr">{tu("op.reference_document_no_optional")}</Label><Input id="jr" value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
                  <select aria-label={`Line ${i + 1} account`} className={`${selectCls} col-span-2 sm:col-span-1`} value={l.account_id} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, account_id: e.target.value } : x))}>
                    <option value="">{tu("op.account")}</option>
                    {accounts.data.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                  <Input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder={tu("op.debit")} value={l.debit} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x))} />
                  <Input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder={tu("op.credit")} value={l.credit} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x))} />
                  <Input aria-label={`Line ${i + 1} note`} placeholder={tu("op.line_note")} maxLength={200} value={l.description} onChange={(e) => setLines(lines.map((x, k) => k === i ? { ...x, description: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={lines.length >= 50} onClick={() => setLines([...lines, emptyLine()])}><Plus className="mr-1 h-4 w-4" />{tu("op.add_line")}</Button>
            </div>
            <div className={`flex flex-wrap justify-between gap-2 rounded-md p-2 text-sm ${balanced ? "bg-primary/5" : "bg-destructive/5"}`} aria-live="polite">
              <span>{tu("op.debit")} {fmt(totals.dr)} · Credit {fmt(totals.cr)}</span>
              <span className="font-medium">{balanced ? tu("op.balanced") : `Difference ${fmt(Math.abs(totals.dr - totals.cr))} — must balance before posting`}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!canSave}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{tu("el.a.saveDraft")}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{tu("op.discard_changes")}</Button>
            </div>
          </form>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-2" role="group" aria-label={tu("op.filter_journals")}>
        {(["all", "draft", "in_review", "posted", "reversed", "cancelled"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => { setStatus(s); setOffset(0); }}>{s === "all" ? tu("common.all") : STATUS_LABEL[s]}</Button>
        ))}
      </div>
      {list.error ? <ErrorBox error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <Loading /> : !list.data?.length ? (
        <EmptyState icon={Scale} title={tu("op.no_journals_here")} description={tu("op.manual_journals_you_create_will")} />
      ) : (
        <ul className="space-y-3">
          {list.data.map((j) => {
            const dr = j.lines.reduce((a, l) => a + l.debit, 0);
            const busy = transition.isPending && transition.variables?.journalId === j.id;
            return (
              <li key={j.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={j.status === "posted" ? "default" : j.status === "cancelled" ? "outline" : "secondary"}>{STATUS_LABEL[j.status]}</Badge>
                  {j.reversed_by_id && <Badge variant="outline">{tu("docState.reversed")}</Badge>}
                  <span className="font-medium">{j.journal_no ?? tu("op.unnumbered_draft")}</span>
                  <span className="text-sm text-muted-foreground">{j.transaction_date}</span>
                  <span className="ml-auto font-semibold tabular-nums">{fmt(dr)}</span>
                </div>
                <p className="mt-1 break-words text-sm">{j.description}{j.reference ? ` · Ref ${j.reference}` : ""}</p>
                {j.cancel_reason && <p className="text-xs text-muted-foreground">{tu("op.cancelled")} {j.cancel_reason}</p>}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <tbody>{j.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.code} · {l.name}</td><td className="py-1 text-right tabular-nums">{l.debit ? fmt(l.debit) : ""}</td><td className="py-1 text-right tabular-nums">{l.credit ? fmt(l.credit) : ""}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!ro && (j.status === "draft" || j.status === "in_review") && <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(j)}>{tu("common.edit")}</Button>
                    {j.status === "draft" && <Button size="sm" variant="outline" disabled={busy} onClick={() => transition.mutate({ journalId: j.id, action: "submit" })}>{tu("op.send_for_review")}</Button>}
                    <Button size="sm" disabled={busy} onClick={() => { if (window.confirm("Post this journal to the ledger? Posted entries cannot be edited.")) transition.mutate({ journalId: j.id, action: "post" }); }}>{tu("mnt.timing.post")}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = askReason("Why cancel this draft? (min 5 characters)"); if (r) transition.mutate({ journalId: j.id, action: "cancel", reason: r }); }}>{tu("op.cancel_draft")}</Button>
                  </>}
                  {!ro && j.status === "posted" && j.source_action === "post" && !j.reversed_by_id && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = askReason("Reason for reversal (min 5 characters)"); if (r) transition.mutate({ journalId: j.id, action: "reverse", reason: r }); }}>{tu("exp.reverse")}</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-between">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{tu("acc.previous")}</Button>
        <Button variant="outline" size="sm" disabled={(list.data?.length ?? 0) < 20} onClick={() => setOffset(offset + 20)}>{tu("acc.next")}</Button>
      </div>
      {!ro && <AddAccountCard societyId={societyId} />}
    </div>
  );
}

function AddAccountCard({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(createFinanceAccount);
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [type, setType] = useState<"asset" | "liability" | "equity" | "income" | "expense">("equity");
  const m = useMutation({ networkMode: "always", retry: false, mutationFn: () => fn({ data: { societyId, code, name, accountType: type } }),
    onSuccess: () => { toast.success(tu("op.account_added")); setCode(""); setName(""); qc.invalidateQueries({ queryKey: ["fin-accounts", societyId] }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <SectionCard title={tu("op.add_an_account")} description={tu("op.for_funds_and_reserves_e")}>
      <form className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div><Label htmlFor="ac">{tu("gp.code")}</Label><Input id="ac" value={code} maxLength={24} placeholder="3100" onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        <div><Label htmlFor="an">{tu("common.name")}</Label><Input id="an" value={name} maxLength={100} placeholder={tu("op.sinking_fund")} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="at">{tu("cm.type")}</Label><select id="at" className={selectCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="asset">{tu("op.asset")}</option><option value="liability">{tu("op.liability")}</option><option value="equity">{tu("op.fund_reserve")}</option><option value="income">{tu("nav.income")}</option><option value="expense">{tu("acc.expense")}</option></select></div>
        <Button type="submit" disabled={m.isPending || !/^[A-Z0-9_-]{2,24}$/.test(code) || name.trim().length < 2}>{tu("vh.add")}</Button>
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
    <SectionCard title={tu("op.trial_balance")} description={tu("op.posted_ledger_only_income_and")}
      action={q.data && <Button size="sm" variant="outline" onClick={() => downloadBlob(new Blob([buildTrialBalanceCsv(q.data!)], { type: "text/csv" }), `trial-balance-${from}-to-${to}.csv`)}><Download className="mr-1 h-4 w-4" />CSV</Button>}>
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-4 space-y-3">
          <BalanceCheck ok={t!.closing_debit === t!.closing_credit && t!.period_debit === t!.period_credit} label={t!.closing_debit === t!.closing_credit ? tu("op.debits_equal_credits") : tu("op.trial_balance_does_not_agree")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground"><tr><th className="py-2">{tu("common.account")}</th><th className="text-right">{tu("op.opening")}</th><th className="text-right">{tu("op.period_dr")}</th><th className="text-right">{tu("op.period_cr")}</th><th className="text-right">{tu("op.closing_dr")}</th><th className="text-right">{tu("op.closing_cr")}</th></tr></thead>
              <tbody>
                {q.data.rows.filter((r) => r.opening_debit || r.opening_credit || r.period_debit || r.period_credit).map((r) => (
                  <tr key={r.code} className="border-t"><td className="py-1.5">{r.code} · {r.name}</td>
                    <td className="text-right tabular-nums">{r.opening_debit ? `${fmt(r.opening_debit)} Dr` : r.opening_credit ? `${fmt(r.opening_credit)} Cr` : "—"}</td>
                    <td className="text-right tabular-nums">{fmt(r.period_debit)}</td><td className="text-right tabular-nums">{fmt(r.period_credit)}</td>
                    <td className="text-right tabular-nums">{r.closing_debit ? fmt(r.closing_debit) : ""}</td><td className="text-right tabular-nums">{r.closing_credit ? fmt(r.closing_credit) : ""}</td></tr>
                ))}
                <tr className="border-t-2 font-semibold"><td className="py-2">{tu("common.total")}</td><td /><td className="text-right tabular-nums">{fmt(t!.period_debit)}</td><td className="text-right tabular-nums">{fmt(t!.period_credit)}</td><td className="text-right tabular-nums">{fmt(t!.closing_debit)}</td><td className="text-right tabular-nums">{fmt(t!.closing_credit)}</td></tr>
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
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_posted_entries")}</p> : (
        <ul className="divide-y text-sm">{rows.map((r) => <li key={r.code} className="flex justify-between gap-3 py-1.5"><span className="min-w-0 break-words">{r.code} · {r.name}</span><span className="tabular-nums">{fmt(r.amount)}</span></li>)}</ul>
      )}
      <p className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold"><span>{tu("common.total")}</span><span className="tabular-nums">{fmt(total)}</span></p>
    </div>
  );
}

function IESectionView({ s, label }: { s: IESection; label: string }) {
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">{label}: {s.from} to {s.to}</p>
      <AmountList title={tu("nav.income")} rows={s.income} total={s.total_income} />
      <AmountList title={tu("op.expenditure")} rows={s.expenditure} total={s.total_expenditure} />
      <p className={`flex justify-between text-base font-semibold ${s.surplus >= 0 ? "text-primary" : "text-destructive"}`}><span>{s.surplus >= 0 ? tu("op.surplus") : tu("op.deficit")}</span><span className="tabular-nums">{fmt(Math.abs(s.surplus))}</span></p>
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
    <SectionCard title={tu("op.income_expenditure_statement")} description={tu("op.from_posted_income_and_expense")}>
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} className="h-4 w-4" />{tu("op.compare_with_the_same_period")}</label>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <IESectionView s={q.data.current} label={tu("rep.current")} />
          {q.data.comparative && <IESectionView s={q.data.comparative} label={tu("acc.previous")} />}
        </div>
      )}
    </SectionCard>
  );
}

function BSSectionView({ s }: { s: BSSection }) {
  const ok = Math.round(s.total_assets * 100) === Math.round((s.total_liabilities + s.total_funds) * 100);
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">{tu("op.as_of")} {s.as_of}</p>
      <AmountList title={tu("op.assets")} rows={s.assets} total={s.total_assets} />
      <AmountList title={tu("op.liabilities")} rows={s.liabilities} total={s.total_liabilities} />
      <div>
        <AmountList title={tu("op.funds_reserves")} rows={[...s.funds,
          { code: "SURPLUS-P", name: "Accumulated surplus — prior years", amount: s.prior_surplus },
          { code: "SURPLUS-C", name: "Surplus / (deficit) — current year", amount: s.current_surplus }]} total={s.total_funds} />
      </div>
      <BalanceCheck ok={ok} label={ok ? tu("op.assets_liabilities_funds") : tu("op.balance_sheet_does_not_agree")} />
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
    <SectionCard title={tu("op.balance_sheet")} description={tu("op.posted_ledger_balances_on_the")}>
      <div className="sm:max-w-xs"><Label htmlFor="bsd">{tu("op.as_of")}</Label><Input id="bsd" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} className="h-4 w-4" />{tu("op.compare_with_previous_year_end")}{cmpAsOf})</label>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : (
        <div className="mt-3 grid gap-4 md:grid-cols-2"><BSSectionView s={q.data.current} />{q.data.comparative && <BSSectionView s={q.data.comparative} />}</div>
      )}
    </SectionCard>
  );
}

/* ---------------- Year close ---------------- */

function YearCloseTab({ societyId }: { societyId: string }) {
  const ro = useRO();
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
    <SectionCard title={tu("op.financial_year_close")} description={tu("op.closing_locks_the_year_no")}>
      <div className="sm:max-w-xs"><Label htmlFor="fy">{tu("op.financial_year_2")}</Label>
        <select id="fy" className={selectCls} value={fy} onChange={(e) => { setFy(e.target.value); setConfirm(""); }}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></div>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !s ? <Loading /> : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {s.status === "closed" ? <Badge><Lock className="mr-1 h-3 w-3" />{tu("hd.st.closed")}</Badge> : <Badge variant="secondary"><Unlock className="mr-1 h-3 w-3" />{tu("common.open")}</Badge>}
            <span className="text-sm text-muted-foreground">{s.fy_start} to {s.fy_end}</span>
            {s.closed_at && <span className="text-sm text-muted-foreground">{tu("hd.st.closed")} {new Date(s.closed_at).toLocaleString("en-IN")}</span>}
          </div>
          {s.reopen_reason && <p className="text-sm text-muted-foreground">{tu("op.last_reopened")} {s.reopen_reason}</p>}
          <div>
            <h3 className="mb-1 text-sm font-semibold">{tu("op.must_be_resolved_before_closing")}</h3>
            <ul className="space-y-1 text-sm">
              {blockers.map(([label, n]) => <li key={label} className="flex justify-between"><span>{label}</span><span className={n > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>{n}</span></li>)}
              <li className="flex justify-between"><span>{tu("op.trial_balance_agrees")}</span><span className={s.blockers.trial_balance_unbalanced ? "font-semibold text-destructive" : "text-muted-foreground"}>{s.blockers.trial_balance_unbalanced ? "No" : tu("op.yes_2")}</span></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{tu("op.warnings_do_not_block_closing")}</h3>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>{tu("op.bank_statement_lines_not_reconciled")}</span><span>{s.warnings.bank_lines_unreconciled}</span></li>
              <li className="flex justify-between"><span>{tu("op.expenses_with_incomplete_tax_setup")}</span><span>{s.warnings.tax_needs_configuration}</span></li>
            </ul>
          </div>
          {ro ? <p className="text-sm text-muted-foreground">{tu("op.read_only_access_year_close")}</p> : s.status === "open" ? (
            !s.year_ended ? <p className="text-sm text-muted-foreground">{tu("op.this_year_has_not_ended")}</p> :
            <form className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
              <Label htmlFor="cc">{tu("cm.type")} <span className="font-mono">{phrase}</span> {tu("op.to_confirm")}</Label>
              <Input id="cc" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              <Button type="submit" disabled={hasBlockers || confirm !== phrase || close.isPending}>{close.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{tu("common.close")} {fyLabel(fy)}</Button>
              {hasBlockers && <p className="text-sm text-destructive">{tu("op.resolve_the_blockers_above_first")}</p>}
            </form>
          ) : (
            <form className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); reopen.mutate(); }}>
              <Label htmlFor="rr">{tu("op.reason_for_reopening_recorded_in")}</Label>
              <Input id="rr" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" variant="outline" disabled={reason.trim().length < 10 || reopen.isPending}>{tu("op.reopen_year")}</Button>
            </form>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------- GST / TDS ---------------- */

function TaxTab({ societyId, from, to, setFrom, setTo }: PeriodProps) {
  const ro = useRO();
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
    onSuccess: () => { toast.success(tu("op.tax_settings_saved")); setCfg(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  const [v, setV] = useState({ vendorId: "", gstin: "", pan: "", state: "", gstRate: "", tdsSection: "", tdsRate: "" });
  const saveVendor = useMutation({ networkMode: "always", retry: false,
    mutationFn: () => vendorFn({ data: { vendorId: v.vendorId, gstin: v.gstin, pan: v.pan, stateCode: v.state, gstRate: v.gstRate === "" ? null : Number(v.gstRate), tdsSection: v.tdsSection, tdsRate: v.tdsRate === "" ? null : Number(v.tdsRate) } }),
    onSuccess: () => { toast.success(tu("op.vendor_tax_profile_saved")); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  const calc = useMutation({ networkMode: "always", retry: false,
    mutationFn: (expenseId: string) => calcFn({ data: { expenseId, includesGst: true, gstRate: null, supplyType: null, tdsSection: null, tdsRate: null } }),
    onSuccess: (r) => { r.status === "calculated" ? toast.success(tu("op.tax_calculated")) : toast.warning(`Needs setup: ${r.missing.join(", ").replace(/_/g, " ")}`); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border bg-muted/40 p-3 text-sm">
        {tu("op.sociyohub_calculates_gst_and_tds")} <strong>{tu("op.not")}</strong> {tu("op.file_returns_or_pay_tax")}
      </div>
      <SectionCard title={tu("op.society_tax_setup")}>
        {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !c ? <Loading /> : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!ro) saveCfg.mutate(); }}>
            <fieldset disabled={ro} className="contents">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.gst} onChange={(e) => setCfg({ ...c, gst: e.target.checked })} />{tu("op.society_is_gst_registered")}</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.tds} onChange={(e) => setCfg({ ...c, tds: e.target.checked })} />{tu("op.society_must_deduct_tds")}</label>
            <div><Label htmlFor="ts">{tu("op.society_state_code_2_digits")}</Label><Input id="ts" inputMode="numeric" maxLength={2} value={c.state} onChange={(e) => setCfg({ ...c, state: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="tt">{tu("op.tan_optional")}</Label><Input id="tt" maxLength={10} value={c.tan} onChange={(e) => setCfg({ ...c, tan: e.target.value.toUpperCase() })} /></div>
            {!ro && <Button type="submit" className="sm:col-span-2 sm:w-fit" disabled={saveCfg.isPending}>{tu("op.save_setup")}</Button>}
            </fieldset>
          </form>
        )}
      </SectionCard>

      {!ro && <SectionCard title={tu("op.vendor_tax_profile")} description={tu("op.used_to_work_out_gst")}>
        {vendors.error ? <ErrorBox error={vendors.error} onRetry={() => vendors.refetch()} /> : (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (v.vendorId) saveVendor.mutate(); }}>
            <div className="sm:col-span-3"><Label htmlFor="vv">{tu("vs.cat.vendor")}</Label>
              <select id="vv" className={selectCls} value={v.vendorId} onChange={(e) => setV({ ...v, vendorId: e.target.value })}>
                <option value="">{tu("op.choose_vendor_2")}</option>
                {(vendors.data?.rows as { id: string; name: string }[] | undefined)?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
            <div><Label htmlFor="vg">GSTIN</Label><Input id="vg" maxLength={15} value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vp">PAN</Label><Input id="vp" maxLength={10} value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vs">{tu("op.state_code")}</Label><Input id="vs" inputMode="numeric" maxLength={2} value={v.state} onChange={(e) => setV({ ...v, state: e.target.value.replace(/\D/g, "") })} /></div>
            <div><Label htmlFor="vr">{tu("op.gst_rate")}</Label><select id="vr" className={selectCls} value={v.gstRate} onChange={(e) => setV({ ...v, gstRate: e.target.value })}>
              <option value="">{tu("op.not_set")}</option>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
            <div><Label htmlFor="vt">{tu("op.tds_section")}</Label><Input id="vt" maxLength={8} placeholder="194C" value={v.tdsSection} onChange={(e) => setV({ ...v, tdsSection: e.target.value.toUpperCase() })} /></div>
            <div><Label htmlFor="vtr">{tu("op.tds_rate")}</Label><Input id="vtr" inputMode="decimal" value={v.tdsRate} onChange={(e) => setV({ ...v, tdsRate: e.target.value })} /></div>
            <Button type="submit" className="sm:w-fit" disabled={!v.vendorId || saveVendor.isPending}>{tu("op.save_vendor_profile")}</Button>
          </form>
        )}
      </SectionCard>}

      <SectionCard title={tu("op.tax_on_posted_expenses")} description={tu("op.expense_amounts_are_treated_as")}>
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {q.data && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[["Taxable value", q.data.totals.taxable], ["CGST", q.data.totals.cgst], ["SGST", q.data.totals.sgst], ["IGST", q.data.totals.igst], ["Total GST", q.data.totals.total_gst], ["TDS", q.data.totals.tds]].map(([l, n]) => (
                <div key={l as string} className="rounded-md border p-2"><p className="text-muted-foreground">{l}</p><p className="font-semibold tabular-nums">{fmt(n as number)}</p></div>
              ))}
              <div className="rounded-md border p-2"><p className="text-muted-foreground">{tu("op.needs_setup")}</p><p className="font-semibold">{q.data.totals.needs_configuration}</p></div>
              <div className="rounded-md border p-2"><p className="text-muted-foreground">{tu("op.not_calculated")}</p><p className="font-semibold">{q.data.totals.not_calculated}</p></div>
            </div>
            {q.data.rows.length === 0 ? <EmptyState icon={Scale} title={tu("op.no_posted_expenses_in_this")} description={tu("op.posted_expenses_appear_here_for")} /> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-muted-foreground"><tr><th className="py-2">{tu("common.date")}</th><th>{tu("op.vendor_category")}</th><th className="text-right">{tu("common.amount")}</th><th className="text-right">GST</th><th className="text-right">TDS</th><th className="text-right">{tu("op.net_payable")}</th><th>{tu("common.status")}</th><th /></tr></thead>
                  <tbody>{q.data.rows.map((r) => (
                    <tr key={r.expense_id} className="border-t align-top">
                      <td className="py-1.5">{r.spent_on}</td><td>{r.vendor ?? tu("exp.noVendor")} · {r.category}</td>
                      <td className="text-right tabular-nums">{fmt(r.amount)}</td>
                      <td className="text-right tabular-nums">{r.tax_status === "calculated" ? `${fmt(r.total_gst)}${r.gst_rate ? ` @${r.gst_rate}%` : ""}${r.supply_type === "inter" ? " IGST" : r.supply_type === "intra" ? " C+S" : ""}` : "—"}</td>
                      <td className="text-right tabular-nums">{r.tax_status === "calculated" ? (r.tds_amount ? `${fmt(r.tds_amount)} ${r.tds_section ?? ""}` : tu("el.a.none")) : "—"}</td>
                      <td className="text-right tabular-nums">{fmt(r.net_payable)}</td>
                      <td>{r.tax_status === "calculated" ? <Badge>{tu("op.calculated")}</Badge> : r.tax_status === "needs_configuration" ? <Badge variant="destructive" title={r.missing.join(", ")}>{tu("op.needs_setup_2")} {r.missing.join(", ").replace(/_/g, " ")}</Badge> : <Badge variant="outline">{tu("op.not_calculated")}</Badge>}</td>
                      <td>{!ro && <Button size="sm" variant="outline" disabled={calc.isPending && calc.variables === r.expense_id} onClick={() => calc.mutate(r.expense_id)}>{r.tax_status === "not_calculated" ? tu("op.calculate") : tu("op.recalculate")}</Button>}</td>
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
    if (!validRange(from, to)) { toast.error(tu("op.choose_a_valid_date_range")); return; }
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
    <SectionCard title={tu("op.tally_ready_export")} description={tu("op.ledgers_with_groups_and_opening")}>
      <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => run("xml")} disabled={!!busy}>{busy === "xml" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}{tu("op.tally_xml")}</Button>
        <Button variant="outline" onClick={() => run("csv")} disabled={!!busy}>{busy === "csv" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}{tu("op.csv_vouchers_ledgers")}</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{tu("op.designed_for_tally_import_workflows")}</p>
    </SectionCard>
  );
}
