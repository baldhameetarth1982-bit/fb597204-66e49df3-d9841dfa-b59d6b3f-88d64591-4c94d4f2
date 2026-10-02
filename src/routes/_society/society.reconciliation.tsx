import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BANK_CSV_MAX_BYTES, parseBankCsv, sha256Hex } from "@/lib/bank-reconciliation";
import {
  confirmBankMatch, ignoreBankLine, importBankStatement, listBankCandidates, listBankLines,
  refreshBankSuggestions, unmatchBankLine, type BankLine,
} from "@/lib/bank-reconciliation.functions";

export const Route = createFileRoute("/_society/society/reconciliation")({
  head: () => ({
    meta: [
      { title: "Bank Reconciliation — SociyoHub" },
      { name: "description", content: "Match bank statement rows to verified society payments and income." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="reconciliation">
      <ReconciliationPage />
    </FeatureGate>
  ),
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const FILTERS: Array<{ value: BankLine["status"] | null; label: string }> = [
  { value: null, label: "All" },
  { value: "suggested", label: "Suggested" },
  { value: "conflict", label: "Needs choice" },
  { value: "unmatched", label: "Unmatched" },
  { value: "already_reconciled", label: "Already reconciled" },
  { value: "matched", label: "Reconciled" },
  { value: "ignored", label: "Explained" },
];

const STATUS_LABEL: Record<BankLine["status"], string> = {
  matched: "Reconciled",
  suggested: "Suggested match",
  conflict: "Needs choice",
  unmatched: "Unmatched",
  already_reconciled: "Already reconciled",
  ignored: "Explained",
};

function ReconciliationPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<BankLine["status"] | null>(null);
  const [candidateLine, setCandidateLine] = useState<BankLine | null>(null);
  const [reasonFor, setReasonFor] = useState<{ line: BankLine; mode: "unmatch" | "ignore" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const listFn = useServerFn(listBankLines);
  const importFn = useServerFn(importBankStatement);
  const confirmFn = useServerFn(confirmBankMatch);
  const refreshFn = useServerFn(refreshBankSuggestions);

  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["bank-recon", societyId, filter],
    queryFn: () => listFn({ data: { societyId: societyId!, status: filter, limit: 200, offset: 0 } }),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["bank-recon", societyId] });

  const importM = useMutation({
    mutationFn: async (file: File) => {
      if (!/\.csv$/i.test(file.name)) throw new Error("Only .csv files are accepted.");
      if (file.size > BANK_CSV_MAX_BYTES) throw new Error("File is larger than 1 MB.");
      const csv = await file.text();
      const local = parseBankCsv(csv);
      if (!local.ok) throw new Error(local.errors.slice(0, 3).join(" "));
      return importFn({ data: { societyId: societyId!, fileName: file.name.slice(0, 120), fileSha256: await sha256Hex(csv), csv } });
    },
    onSuccess: (r) => {
      if (r.status === "invalid") toast.error(r.errors.slice(0, 3).join(" "));
      else if (r.status === "already_imported") toast.info("This exact file was already imported.");
      else toast.success(`Imported ${r.rows} rows. ${r.suggested} suggested matches${r.duplicates ? `, ${r.duplicates} possible duplicates` : ""}.`);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const confirmM = useMutation({
    mutationFn: (v: { lineId: string; kind: "payment" | "income"; recordId: string }) => confirmFn({ data: v }),
    onSuccess: () => { toast.success("Reconciled."); setCandidateLine(null); invalidate(); },
    onError: (e) => { toast.error((e as Error).message); invalidate(); },
  });
  const refreshM = useMutation({
    mutationFn: () => refreshFn({ data: { societyId: societyId! } }),
    onSuccess: () => { toast.success("Suggestions refreshed."); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const s = q.data?.summary ?? {};
  const stat = (k: BankLine["status"]) => s[k] ?? { count: 0, amount: 0 };
  const open = ["suggested", "conflict", "unmatched", "already_reconciled"] as const;
  const openCount = open.reduce((a, k) => a + stat(k).count, 0);

  return (
    <PageShell>
      <PageHeader
        title="Bank reconciliation"
        description="Import your bank statement and confirm which rows match verified payments and income."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refreshM.mutate()} disabled={!societyId || refreshM.isPending} className="min-h-11">
              {refreshM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              <span className="ml-1.5">Refresh</span>
            </Button>
            <Button onClick={() => fileRef.current?.click()} disabled={!societyId || importM.isPending} className="min-h-11">
              {importM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              <span className="ml-1.5">Import CSV</span>
            </Button>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Bank statement CSV file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importM.mutate(f); }}
            />
          </div>
        }
      />

      <div className="rounded-2xl border bg-muted/40 p-4 text-sm flex gap-3 mb-5">
        <Info className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <div className="space-y-1">
          <p>Bank rows are evidence only. Importing never creates, verifies or changes payments, receipts or the ledger. A row counts as reconciled only after you confirm it.</p>
          <p className="text-muted-foreground">CSV columns: Date, Description, Reference (optional), and either Credit + Debit or Amount + Type (CR/DR). Up to 2,000 rows, 1 MB.</p>
        </div>
      </div>

      {q.isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" /> {(q.error as Error).message}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Reconciled" v={stat("matched")} />
            <Stat label="Suggested" v={stat("suggested")} />
            <Stat label="Unmatched" v={{ count: stat("unmatched").count + stat("conflict").count, amount: stat("unmatched").amount + stat("conflict").amount }} />
            <Stat label="Already reconciled" v={stat("already_reconciled")} />
          </div>
          <p className="text-sm text-muted-foreground mb-3">{openCount} rows still need attention.</p>

          <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Filter bank rows">
            {FILTERS.map((f) => (
              <Button key={f.label} role="tab" aria-selected={filter === f.value} size="sm" variant={filter === f.value ? "default" : "outline"}
                className="rounded-full shrink-0 min-h-9" onClick={() => setFilter(f.value)}>
                {f.label}
              </Button>
            ))}
          </div>

          {q.isLoading ? (
            <div className="py-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (q.data?.rows.length ?? 0) === 0 ? (
            <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">No bank rows here yet. Import a CSV statement to begin.</div>
          ) : (
            <ul className="divide-y rounded-2xl border">
              {q.data!.rows.map((l) => (
                <li key={l.id} className="p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold tabular-nums">{l.direction === "credit" ? "+" : "−"}{inr(l.amount)}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(l.txn_date)}</span>
                      <Badge variant={l.status === "matched" ? "default" : "outline"} className="rounded-full text-[11px]">{STATUS_LABEL[l.status]}</Badge>
                      {l.match_strength && l.status === "suggested" && <Badge variant="secondary" className="rounded-full text-[11px]">{l.match_strength === "strong" ? "Reference match" : "Amount + date"}</Badge>}
                      {l.is_duplicate && <Badge variant="outline" className="rounded-full text-[11px] border-destructive/40 text-destructive">Possible duplicate</Badge>}
                      {l.record_reversed && <Badge variant="outline" className="rounded-full text-[11px] border-destructive/40 text-destructive">Record reversed — review</Badge>}
                    </div>
                    <p className="text-sm truncate">{l.description}{l.reference ? ` · ${l.reference}` : ""}</p>
                    {l.record_label && <p className="text-xs text-muted-foreground truncate">{l.status === "matched" ? "Linked to" : "Suggested"}: {l.record_label}</p>}
                    {l.status === "conflict" && <p className="text-xs text-muted-foreground">{l.candidate_count} records fit equally. Choose the right one.</p>}
                    {l.direction === "debit" && l.status === "unmatched" && <p className="text-xs text-muted-foreground">Outgoing payment. Mark it explained once checked.</p>}
                    {l.note && l.status !== "matched" && <p className="text-xs text-muted-foreground truncate">Note: {l.note}</p>}
                  </div>
                  <div className="flex gap-2 flex-wrap md:justify-end">
                    {l.status === "suggested" && l.record_kind && l.record_id && (
                      <Button size="sm" className="min-h-10" disabled={confirmM.isPending}
                        onClick={() => confirmM.mutate({ lineId: l.id, kind: l.record_kind!, recordId: l.record_id! })}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm
                      </Button>
                    )}
                    {l.direction === "credit" && ["suggested", "conflict", "unmatched"].includes(l.status) && (
                      <Button size="sm" variant="outline" className="min-h-10" onClick={() => setCandidateLine(l)}>Choose record</Button>
                    )}
                    {!["matched", "ignored"].includes(l.status) && (
                      <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setReasonFor({ line: l, mode: "ignore" })}>Mark explained</Button>
                    )}
                    {["matched", "ignored"].includes(l.status) && (
                      <Button size="sm" variant="ghost" className="min-h-10" onClick={() => setReasonFor({ line: l, mode: "unmatch" })}>Undo</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {candidateLine && (
        <CandidateDialog line={candidateLine} onClose={() => setCandidateLine(null)} pending={confirmM.isPending}
          onPick={(kind, recordId) => confirmM.mutate({ lineId: candidateLine.id, kind, recordId })} />
      )}
      {reasonFor && <ReasonDialog {...reasonFor} onClose={() => setReasonFor(null)} onDone={invalidate} />}
    </PageShell>
  );
}

function Stat({ label, v }: { label: string; v: { count: number; amount: number } }) {
  return (
    <div className="rounded-2xl border p-3 min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{v.count}</p>
      <p className="text-xs text-muted-foreground tabular-nums break-all">{inr(v.amount)}</p>
    </div>
  );
}

function CandidateDialog({ line, onClose, onPick, pending }: {
  line: BankLine; onClose: () => void; pending: boolean; onPick: (k: "payment" | "income", id: string) => void;
}) {
  const fn = useServerFn(listBankCandidates);
  const q = useQuery({ queryKey: ["bank-cand", line.id], queryFn: () => fn({ data: { lineId: line.id } }), retry: false });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose the matching record</DialogTitle>
          <DialogDescription>Verified bank transfers of {inr(line.amount)} within 7 days of {fmtDate(line.txn_date)}.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : q.isError ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No verified record matches this amount and date. Record the payment first, or mark this row explained.</p>
        ) : (
          <ul className="divide-y rounded-xl border max-h-80 overflow-y-auto">
            {q.data!.map((c) => (
              <li key={c.kind + c.record_id} className="p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(c.record_date)}{c.reference ? ` · ref ${c.reference}` : ""}</p>
                </div>
                {c.already_reconciled ? <Badge variant="outline" className="rounded-full">Already reconciled</Badge> : (
                  <Button size="sm" className="min-h-10" disabled={pending} onClick={() => onPick(c.kind, c.record_id)}>Confirm</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ line, mode, onClose, onDone }: { line: BankLine; mode: "unmatch" | "ignore"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const unmatch = useServerFn(unmatchBankLine);
  const ignore = useServerFn(ignoreBankLine);
  const m = useMutation({
    mutationFn: () => (mode === "unmatch" ? unmatch : ignore)({ data: { lineId: line.id, reason: reason.trim() } }),
    onSuccess: () => { toast.success(mode === "unmatch" ? "Undone." : "Marked explained."); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const valid = reason.trim().length >= 5;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "unmatch" ? "Undo reconciliation" : "Mark as explained"}</DialogTitle>
          <DialogDescription>
            {mode === "unmatch" ? "The bank row goes back to open. The payment or income record itself is not changed." : "Use for bank charges, interest, outgoing payments or duplicate rows."} A reason is saved in the audit log.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="recon-reason" className="text-sm font-medium">Reason</label>
        <Textarea id="recon-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        {!valid && reason.length > 0 && <p className="text-xs text-destructive">At least 5 characters.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11">Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!valid || m.isPending} className="min-h-11">
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
