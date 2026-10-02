import { createFileRoute } from "@tanstack/react-router";
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
    {rej.length > 0 && <ul className="text-xs text-muted-foreground">{rej.map((x) => <li key={x.row}>Row {x.row + 1}: {REJECT[x.code] ?? x.code}</li>)}
      {r.rejected.length > 8 && <li>…and {r.rejected.length - 8} more</li>}</ul>}
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
    onSuccess: () => { toast.success("Saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const undoM = useMutation({
    mutationFn: (v: { b: FinanceImportBatch; reason: string }) => undo({ data: { societyId: societyId!, requestId: v.b.request_id, kind: v.b.kind, reason: v.reason } }),
    onSuccess: (r) => { toast.success(`Import undone — ${r.undone} rows marked as undone. History is kept.`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const askReject = (kind: Kind, id: string) => { const note = window.prompt("Reason for rejecting (required)")?.trim(); if (note) reviewM.mutate({ kind, id, confirm: false, note: note.slice(0, 500) }); };

  const uploader = (kind: Kind, cols: string) => <SectionCard title="Import" description="CSV or Excel (.xlsx), up to 5,000 rows. A dry run comes first — nothing is saved until you confirm.">
    <p className="mb-3 text-sm text-muted-foreground">{cols} Dates as YYYY-MM-DD or DD/MM/YYYY; amounts may include ₹ and commas. Values only — formulas are never run.</p>
    <label className="inline-flex">
      <input type="file" accept=".csv,.xlsx" className="hidden" disabled={!societyId || dryM.isPending || importM.isPending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) dryM.mutate({ kind, f }); e.target.value = ""; }} />
      <Button asChild variant="outline" className="min-h-11 rounded-xl"><span>
        {dryM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Choose file for dry run
      </span></Button>
    </label>
    {pending?.kind === kind && <div className="mt-4 space-y-3 rounded-xl border bg-muted/40 p-3">
      <p className="text-sm font-semibold">Dry run of {pending.file} — nothing saved yet</p>
      <Summary r={pending.result} />
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending.result.imported === 0 || importM.isPending} onClick={() => importM.mutate(pending)}>
          {importM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Import {pending.result.imported} valid row{pending.result.imported === 1 ? "" : "s"} as unverified
        </Button>
        <Button variant="outline" className="min-h-11" onClick={() => setPending(null)}>Cancel</Button>
      </div>
      {pending.result.rejected.length > 0 && <p className="text-xs text-muted-foreground">Problem rows are not imported. Fix them in your file and run it again — rows already imported are recognised and never duplicated.</p>}
    </div>}
    {done && !pending && done.dryRun === false && <div className="mt-4 rounded-xl border p-3">
      <p className="mb-2 text-sm font-semibold">{done.replay ? "This import was already saved earlier — nothing duplicated." : done.rejected.length ? "Partly imported — awaiting committee review" : "Imported — awaiting committee review"}</p>
      <Summary r={done} />
    </div>}
  </SectionCard>;

  const loadState = (q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }) => <>
    {q.isLoading && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
    {q.isError && <div className="p-4"><p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{(q.error as Error).message}</p>
      <Button className="mt-3 min-h-11" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>}
  </>;
  const reviewBtns = (kind: Kind, id: string) => <div className="flex gap-2">
    <Button size="sm" className="min-h-11" disabled={reviewM.isPending} onClick={() => reviewM.mutate({ kind, id, confirm: true })}>Confirm</Button>
    <Button size="sm" variant="outline" className="min-h-11" disabled={reviewM.isPending} onClick={() => askReject(kind, id)}>Reject</Button>
  </div>;

  return (<div className="pb-24">
    <MobileHero eyebrow="Migration" title="Old dues & past payments" subtitle="Bring history from your previous records. Everything is checked in a dry run first, stays unverified until the committee confirms it, and can be undone." icon={Landmark} variant="teal" />
    <div className="max-w-3xl px-4 pt-4 md:px-6">
      <Tabs defaultValue="ob" onValueChange={() => { setPending(null); setDone(null); }}>
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="ob" className="min-h-10">Opening balances</TabsTrigger>
          <TabsTrigger value="hp" className="min-h-10">Past payments</TabsTrigger>
          <TabsTrigger value="hist" className="min-h-10">Import history</TabsTrigger>
        </TabsList>

        <TabsContent value="ob" className="space-y-4">
          {uploader("opening_balance", "Columns: Block, Flat, Amount, As of.")}
          <SectionCard title="Imported balances" description="Review against your old records" bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">Unverified or rejected rows never count. Confirmed rows appear in dues ageing and No-Dues, then move once onto the house's next bill as previous dues. No payment or receipt is ever created.</p>
            {loadState(obQ)}
            {obQ.data && obQ.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing imported yet.</p>}
            {obQ.data && obQ.data.length > 0 && <ul className="divide-y">{obQ.data.map((r) => {
              const st = r.review_note?.startsWith("Import undone:") ? STATUS.reversed : STATUS[r.status] ?? { label: r.status, tone: "warning" as const };
              return <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.unit || "—"}</p>
                  <p className="text-xs text-muted-foreground">As of {r.as_of}{r.source_ref ? ` · ${r.source_ref}` : ""}{r.review_note ? ` · ${r.review_note}` : ""}</p></div>
                <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>
                <StatusChip tone={st.tone}>{st.label}</StatusChip>
                {r.carried && <StatusChip tone="neutral">On a bill</StatusChip>}
                {r.status === "imported_unverified" && reviewBtns("opening_balance", r.id)}
              </li>;
            })}</ul>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="hp" className="space-y-4">
          {uploader("past_payment", "Columns: Block, Flat, Amount, Payment date, Method (cash, bank, cheque, UPI…), Reference, Receipt no.")}
          <SectionCard title="Imported past payments" description="Kept as history, separate from money received in SociyoHub" bodyClassName="p-0">
            <p className="px-4 pt-3 text-xs text-muted-foreground">Past payments are a record of your old books. They never create receipts, notifications or new income, and never change dues or your accounts — your confirmed opening balance is the starting point. Confirmed rows are shown to the flat's current residents as payment history.</p>
            {loadState(hpQ)}
            {hpQ.data && hpQ.data.items.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing imported yet.</p>}
            {hpQ.data && hpQ.data.items.length > 0 && <ul className="divide-y">{hpQ.data.items.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: "warning" as const };
              return <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.unit || "—"}</p>
                  <p className="text-xs text-muted-foreground">{r.payment_date} · {r.method.replace("_", " ")}{r.reference_no ? ` · Ref ${r.reference_no}` : ""}{r.receipt_ref ? ` · Old receipt ${r.receipt_ref}` : ""}{r.review_note ? ` · ${r.review_note}` : ""}</p></div>
                <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>
                <StatusChip tone={st.tone}>{st.label}</StatusChip>
                {r.status === "imported_unverified" && reviewBtns("past_payment", r.id)}
              </li>;
            })}</ul>}
            {hpQ.data && hpQ.data.total > hpQ.data.items.length && <p className="p-4 text-xs text-muted-foreground">Showing the latest {hpQ.data.items.length} of {hpQ.data.total}.</p>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="hist">
          <SectionCard title="Import history" description="Every file imported, by whom it was reviewed, and whether it was undone" bodyClassName="p-0">
            {loadState(bQ)}
            {bQ.data && bQ.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">No imports yet.</p>}
            {bQ.data && bQ.data.length > 0 && <ul className="divide-y">{bQ.data.map((b) => {
              const canUndo = b.kind === "past_payment" ? b.unverified + b.confirmed > 0 : b.unverified > 0 && b.confirmed === 0;
              return <li key={b.kind + b.request_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <History className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.source_ref ?? "Import"} <span className="text-xs font-normal text-muted-foreground">· {b.kind === "opening_balance" ? "Opening balances" : "Past payments"}</span></p>
                  <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-IN")} · {b.rows} rows · {b.unverified} unverified · {b.confirmed} confirmed · {b.rejected} rejected{b.reversed ? ` · ${b.reversed} undone` : ""}{b.total ? ` · ${inr(Number(b.total))}` : ""}</p>
                </div>
                {b.undone && <StatusChip tone="neutral">Undone</StatusChip>}
                {canUndo && <Button size="sm" variant="outline" className="min-h-11" disabled={undoM.isPending}
                  onClick={() => { const reason = window.prompt("Undo this whole import? Rows are marked as undone, never deleted. Reason (required):")?.trim();
                    if (reason && reason.length >= 5) undoM.mutate({ b, reason: reason.slice(0, 400) }); else if (reason) toast.error("Add a short reason (at least 5 characters)."); }}>
                  <Undo2 className="mr-1.5 h-4 w-4" />Undo import</Button>}
                {b.kind === "opening_balance" && b.confirmed > 0 && b.unverified > 0 && <span className="text-xs text-muted-foreground">Some rows confirmed — reject the rest one by one.</span>}
              </li>;
            })}</ul>}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  </div>);
}
