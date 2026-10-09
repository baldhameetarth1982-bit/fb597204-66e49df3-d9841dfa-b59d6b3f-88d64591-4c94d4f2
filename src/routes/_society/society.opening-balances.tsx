import { createFileRoute } from "@tanstack/react-router";
import { askText } from "@/components/system/AskTextDialog";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Landmark, Loader2, Upload, History, Undo2 } from "lucide-react";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusChip } from "@/components/system/StatusChip";
import { useSocietyId } from "@/hooks/useSocietyId";
import { listOpeningBalances, reviewOpeningBalance } from "@/lib/workstream7.functions";
import {
  importOpeningBalancesV2, importHistoricalPayments, listHistoricalPayments, reviewHistoricalPayment,
  listFinanceImportBatches, undoFinanceImportBatch, type ImportOutcome, type FinanceImportBatch,
} from "@/lib/data-import.functions";
import { pick, readSheetRows } from "@/lib/sheet-rows";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/opening-balances")({
  head: () => ({ meta: [
    { title: "Old dues & past payments — SociyoHub" },
    { name: "description", content: "Import old dues and past payments with a dry run, review them, and undo an import safely." },
    { property: "og:title", content: "Old dues & past payments — SociyoHub" },
    { property: "og:description", content: "Import old dues and past payments with a dry run, review them, and undo an import safely." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OpeningBalancesPage,
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  imported_unverified: { label: "Imported – unverified", tone: "warning" },
  confirmed: { label: "Confirmed by committee", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  reversed: { label: "Undone", tone: "neutral" },
};
const REJECT: Record<string, string> = {
  missing_unit: "flat missing", unit_not_found: "flat not found", ambiguous_unit: "more than one flat matches",
  invalid_amount: "invalid amount", invalid_date: "invalid or future date", invalid_method: "unknown payment method",
  duplicate_in_file: "repeated in this file", already_imported: "already imported", matches_live_payment: "same reference as a payment already in SociyoHub",
  value_too_long: "value too long", unsafe_value: "value starts with = + - or @",
};

type Kind = "opening_balance" | "past_payment";
type Pending = { kind: Kind; file: string; requestId: string; rows: Record<string, string>[]; result: ImportOutcome };

function toRows(kind: Kind, rows: Record<string, string>[]) {
  return rows.map((x) => kind === "opening_balance" ? {
    block: pick(x, "block", "structure", "wing", "tower").slice(0, 80),
    unit: pick(x, "unit", "flat", "flat_number", "flat_no", "house").slice(0, 40),
    amount: pick(x, "amount", "opening_balance", "dues", "arrears").slice(0, 30),
    as_of: pick(x, "as_of", "date", "as_on").slice(0, 20),
  } : {
    block: pick(x, "block", "structure", "wing", "tower").slice(0, 80),
    unit: pick(x, "unit", "flat", "flat_number", "flat_no", "house").slice(0, 40),
    amount: pick(x, "amount", "paid", "amount_paid").slice(0, 30),
    payment_date: pick(x, "payment_date", "date", "paid_on").slice(0, 20),
    method: pick(x, "method", "mode", "payment_mode").slice(0, 30),
    reference_no: pick(x, "reference", "reference_no", "ref", "utr", "cheque_no", "transaction_id").slice(0, 120),
    receipt_ref: pick(x, "receipt", "receipt_no", "receipt_number").slice(0, 120),
  });
}

function Summary({ r }: { r: ImportOutcome }) {
  const rej = r.rejected.slice(0, 8);
  return <div className="space-y-2 text-sm">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {([["Rows", r.total], [r.dryRun ? "Ready to import" : "Imported", r.imported], ["Duplicates", r.duplicates], ["Problems", r.rejected.length - r.duplicates]] as const)
        .map(([l, v]) => <div key={l} className="rounded-lg border p-2"><div className="text-xs text-muted-foreground">{l}</div><div className="font-semibold tabular-nums">{v}</div></div>)}
    </div>
    {rej.length > 0 && <ul className="text-xs text-muted-foreground">{rej.map((x) => <li key={x.row}>{tu("op.row")} {x.row + 1}: {REJECT[x.code] ?? x.code}</li>)}
      {r.rejected.length > 8 && <li>…and {r.rejected.length - 8} {tu("op.more")}</li>}</ul>}
  </div>;
}

function OpeningBalancesPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const listOb = useServerFn(listOpeningBalances);
  const reviewOb = useServerFn(reviewOpeningBalance);
  const impOb = useServerFn(importOpeningBalancesV2);
  const impHp = useServerFn(importHistoricalPayments);
  const listHp = useServerFn(listHistoricalPayments);
  const reviewHp = useServerFn(reviewHistoricalPayment);
  const listBatches = useServerFn(listFinanceImportBatches);
  const undo = useServerFn(undoFinanceImportBatch);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);

  const obQ = useQuery({ queryKey: ["opening-balances", societyId], enabled: !!societyId, queryFn: () => listOb({ data: { societyId: societyId! } }) });
  const hpQ = useQuery({ queryKey: ["historical-payments", societyId], enabled: !!societyId, queryFn: () => listHp({ data: { societyId: societyId!, offset: 0 } }) });
  const bQ = useQuery({ queryKey: ["finance-import-batches", societyId], enabled: !!societyId, queryFn: () => listBatches({ data: { societyId: societyId! } }) });
  const refresh = () => ["opening-balances", "historical-payments", "finance-import-batches"].forEach((k) => qc.invalidateQueries({ queryKey: [k, societyId] }));

  const run = (kind: Kind, requestId: string, file: string, rows: Record<string, string>[], dryRun: boolean) => {
    const base = { societyId: societyId!, requestId, sourceRef: file.slice(0, 120), dryRun };
    return kind === "opening_balance"
      ? impOb({ data: { ...base, rows: toRows(kind, rows) as never } })
      : impHp({ data: { ...base, rows: toRows(kind, rows) as never } });
  };

  const dryM = useMutation({
    mutationFn: async ({ kind, f }: { kind: Kind; f: File }) => {
      const r = await readSheetRows(f);
      if (!r.ok) throw new Error(r.error);
      const requestId = crypto.randomUUID();
      return { kind, file: f.name, requestId, rows: r.rows, result: await run(kind, requestId, f.name, r.rows, true) };
    },
    onSuccess: (p) => { setDone(null); setPending(p); },
    onError: (e: Error) => toast.error(e.message),
  });
  const importM = useMutation({
    mutationFn: (p: Pending) => run(p.kind, p.requestId, p.file, p.rows, false),
    onSuccess: (r) => { setPending(null); setDone(r); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reviewM = useMutation({
    mutationFn: (v: { kind: Kind; id: string; confirm: boolean; note?: string }) =>
      v.kind === "opening_balance" ? reviewOb({ data: { id: v.id, confirm: v.confirm, note: v.note } }) : reviewHp({ data: { id: v.id, confirm: v.confirm, note: v.note } }),
    onSuccess: () => { toast.success(tu("op.saved")); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const undoM = useMutation({
    mutationFn: (v: { b: FinanceImportBatch; reason: string }) => undo({ data: { societyId: societyId!, requestId: v.b.request_id, kind: v.b.kind, reason: v.reason } }),
    onSuccess: (r) => { toast.success(`Import undone — ${r.undone} rows marked as undone. History is kept.`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const askReject = async (kind: Kind, id: string) => { const note = (await askText("Reason for rejecting (required)"))?.trim(); if (note) reviewM.mutate({ kind, id, confirm: false, note: note.slice(0, 500) }); };

  const uploader = (kind: Kind, cols: string) => <SectionCard title={tu("op.import")} description={tu("op.csv_or_excel_xlsx_up")}>
    <p className="mb-3 text-sm text-muted-foreground">{cols} {tu("op.dates_as_yyyy_mm_dd")}</p>
    <label className="inline-flex">
      <input type="file" accept=".csv,.xlsx" className="hidden" disabled={!societyId || dryM.isPending || importM.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) dryM.mutate({ kind, f }); e.target.value = ""; }} />
      <Button asChild variant="outline" className="min-h-11 rounded-xl"><span>
        {dryM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}{tu("op.choose_file_for_dry_run")}
      </span></Button>
    </label>
    {pending?.kind === kind && <div className="mt-4 space-y-3 rounded-xl border bg-muted/40 p-3">
      <p className="text-sm font-semibold">{tu("op.dry_run_of")} {pending.file} — nothing saved yet</p>
      <Summary r={pending.result} />
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending.result.imported === 0 || importM.isPending} onClick={() => importM.mutate(pending)}>
          {importM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tu("op.import")} {pending.result.imported} {tu("op.valid_row")}{pending.result.imported === 1 ? "" : "s"} {tu("op.as_unverified")}
        </Button>
        <Button variant="outline" className="min-h-11" onClick={() => setPending(null)}>{tu("common.cancel")}</Button>
      </div>
      {pending.result.rejected.length > 0 && <p className="text-xs text-muted-foreground">{tu("op.problem_rows_are_not_imported")}</p>}
    </div>}
    {done && !pending && done.dryRun === false && <div className="mt-4 rounded-xl border p-3">
      <p className="mb-2 text-sm font-semibold">{done.replay ? tu("op.this_import_was_already_saved") : done.rejected.length ? tu("op.partly_imported_awaiting_committee_revie") : tu("op.imported_awaiting_committee_review")}</p>
      <Summary r={done} />
    </div>}
  </SectionCard>;

  const loadState = (q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }) => <>
    {q.isLoading && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tu("common.loading")}</p>}
    {q.isError && <div className="p-4"><p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{(q.error as Error).message}</p>
      <Button className="mt-3 min-h-11" variant="outline" onClick={() => q.refetch()}>{tu("common.retry")}</Button></div>}
  </>;
  const reviewBtns = (kind: Kind, id: string) => <div className="flex gap-2">
    <Button size="sm" className="min-h-11" disabled={reviewM.isPending} onClick={() => reviewM.mutate({ kind, id, confirm: true })}>{tu("common.confirm")}</Button>
    <Button size="sm" variant="outline" className="min-h-11" disabled={reviewM.isPending} onClick={() => askReject(kind, id)}>{tu("el.a.reject")}</Button>
  </div>;

  return (<div className="pb-24">
    <MobileHero eyebrow={tu("op.migration")} title={tu("op.old_dues_past_payments")} subtitle={tu("op.bring_history_from_your_previous")} icon={Landmark} variant="teal" />
    <div className="max-w-3xl px-4 pt-4 md:px-6">
      <Tabs defaultValue="ob" onValueChange={() => { setPending(null); setDone(null); }}>
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="ob" className="min-h-10">{tu("op.opening_balances")}</TabsTrigger>
          <TabsTrigger value="hp" className="min-h-10">{tu("op.past_payments")}</TabsTrigger>
          <TabsTrigger value="hist" className="min-h-10">{tu("op.import_history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="ob" className="space-y-4">
          {uploader("opening_balance", "Columns: Block, Flat, Amount, As of.")}
          <SectionCard title={tu("op.imported_balances")} description={tu("op.review_against_your_old_records")} bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">{tu("op.unverified_or_rejected_rows_never")}</p>
            {loadState(obQ)}
            {obQ.data && obQ.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">{tu("op.nothing_imported_yet")}</p>}
            {obQ.data && obQ.data.length > 0 && <ul className="divide-y">{(obQ.data as { id: string; amount: number; as_of: string; status: string; source_ref: string | null; review_note: string | null; carried: boolean; unit: string }[]).map((r) => {
              const st = r.review_note?.startsWith("Import undone:") ? STATUS.reversed : STATUS[r.status] ?? { label: r.status, tone: "warning" as const };
              return <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.unit || "—"}</p>
                  <p className="text-xs text-muted-foreground">{tu("op.as_of")} {r.as_of}{r.source_ref ? ` · ${r.source_ref}` : ""}{r.review_note ? ` · ${r.review_note}` : ""}</p></div>
                <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>
                <StatusChip tone={st.tone}>{st.label}</StatusChip>
                {r.carried && <StatusChip tone="neutral">{tu("op.on_a_bill")}</StatusChip>}
                {r.status === "imported_unverified" && reviewBtns("opening_balance", r.id)}
              </li>;
            })}</ul>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="hp" className="space-y-4">
          {uploader("past_payment", "Columns: Block, Flat, Amount, Payment date, Method (cash, bank, cheque, UPI…), Reference, Receipt no.")}
          <SectionCard title={tu("op.imported_past_payments")} description={tu("op.kept_as_history_separate_from")} bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">{tu("op.past_payments_are_a_record")}</p>
            {loadState(hpQ)}
            {hpQ.data && hpQ.data.items.length === 0 && <p className="p-4 text-sm text-muted-foreground">{tu("op.nothing_imported_yet")}</p>}
            {hpQ.data && hpQ.data.items.length > 0 && <ul className="divide-y">{(hpQ.data.items as { id: string; amount: number; payment_date: string; method: string; reference_no: string | null; receipt_ref: string | null; status: string; review_note: string | null; unit: string }[]).map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: "warning" as const };
              return <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.unit || "—"}</p>
                  <p className="text-xs text-muted-foreground">{r.payment_date} · {r.method.replace("_", " ")}{r.reference_no ? ` · Ref ${r.reference_no}` : ""}{r.receipt_ref ? ` · Old receipt ${r.receipt_ref}` : ""}{r.review_note ? ` · ${r.review_note}` : ""}</p></div>
                <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>
                <StatusChip tone={st.tone}>{st.label}</StatusChip>
                {r.status === "imported_unverified" && reviewBtns("past_payment", r.id)}
              </li>;
            })}</ul>}
            {hpQ.data && hpQ.data.total > hpQ.data.items.length && <p className="p-4 text-xs text-muted-foreground">{tu("op.showing_the_latest")} {hpQ.data.items.length} of {hpQ.data.total}.</p>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="hist">
          <SectionCard title={tu("op.import_history")} description={tu("op.every_file_imported_by_whom")} bodyClassName="p-0">
            {loadState(bQ)}
            {bQ.data && bQ.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">{tu("op.no_imports_yet")}</p>}
            {bQ.data && bQ.data.length > 0 && <ul className="divide-y">{bQ.data.map((b) => {
              const canUndo = b.kind === "past_payment" ? b.unverified + b.confirmed > 0 : b.unverified > 0 && b.confirmed === 0;
              return <li key={b.kind + b.request_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <History className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.source_ref ?? tu("op.import")} <span className="text-xs font-normal text-muted-foreground">· {b.kind === "opening_balance" ? tu("op.opening_balances") : tu("op.past_payments")}</span></p>
                  <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-IN")} · {b.rows} {tu("op.rows")} {b.unverified} {tu("op.unverified")} {b.confirmed} {tu("op.confirmed")} {b.rejected} {tu("mt.out.rejected")}{b.reversed ? ` · ${b.reversed} undone` : ""}{b.total ? ` · ${inr(Number(b.total))}` : ""}</p>
                </div>
                {b.undone && <StatusChip tone="neutral">{tu("op.undone_3")}</StatusChip>}
                {canUndo && <Button size="sm" variant="outline" className="min-h-11" disabled={undoM.isPending}
                  onClick={async () => { const reason = (await askText("Undo this whole import? Rows are marked as undone, never deleted. Reason (required):", { minLength: 5 }))?.trim();
                    if (reason && reason.length >= 5) undoM.mutate({ b, reason: reason.slice(0, 400) }); else if (reason) toast.error(tu("op.add_a_short_reason_at")); }}>
                  <Undo2 className="mr-1.5 h-4 w-4" />{tu("op.undo_import")}</Button>}
                {b.kind === "opening_balance" && b.confirmed > 0 && b.unverified > 0 && <span className="text-xs text-muted-foreground">{tu("op.some_rows_confirmed_reject_the")}</span>}
              </li>;
            })}</ul>}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  </div>);
}
