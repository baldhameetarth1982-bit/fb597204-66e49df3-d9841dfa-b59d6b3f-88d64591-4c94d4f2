import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, FileUp, Loader2, ScanText, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { EXPENSE_CATEGORIES, fieldLabel, type InvoiceFields } from "@/lib/invoice-ai";
import {
  confirmInvoiceExtraction, extractInvoice, getInvoiceFileUrl, listInvoiceExtractions, listLinkableProcurement, rejectInvoiceExtraction,
  type InvoiceExtractionRow,
} from "@/lib/invoice-ai.functions";
import { tu } from "@/lib/i18n";

type Vendor = { id: string; name: string };
const ERR: Record<string, string> = {
  duplicate_invoice: "This invoice number was already confirmed for this vendor.",
  invalid_state: "This invoice was already confirmed or rejected.",
  not_authorized: "Only finance admins can do this.",
  invalid_amount: "Enter a valid amount (up to 2 decimals).",
  invalid_date: "Expense date can't be in the future.",
  vendor_not_found: "That vendor isn't active in this society.",
  invalid_invoice_number: "Invoice number can use letters, numbers and / - _ . # only.",
  period_closed: "That date is in a closed financial year.",
  procurement_already_closed: "That purchase request is already completed or closed.",
  procurement_not_approved: "That purchase request hasn't been approved yet.",
  procurement_already_invoiced: "Another invoice is already confirmed for that purchase request.",
};
const msg = (e: unknown) => ERR[(e as Error)?.message] ?? "Something went wrong. Please try again.";
const STATUS: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" | "default" }> = {
  processing: { label: "Processing", variant: "secondary" }, extracted: { label: "Ready to review", variant: "default" },
  needs_review: { label: "Needs review", variant: "destructive" }, failed: { label: "Couldn't read", variant: "outline" },
  confirmed: { label: "Expense created", variant: "secondary" }, rejected: { label: "Discarded", variant: "outline" },
};

function toB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("read"));
    r.readAsDataURL(file);
  });
}

export function InvoiceAiCard({ societyId, vendors }: { societyId: string; vendors: Vendor[] }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const extract = useServerFn(extractInvoice);
  const listFn = useServerFn(listInvoiceExtractions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [review, setReview] = useState<InvoiceExtractionRow | null>(null);
  const list = useQuery({ queryKey: ["invoice-ai", societyId], queryFn: () => listFn({ data: { societyId } }), retry: false });

  async function run(file: File) {
    setError(null); setLastFile(file);
    if (file.size > 5 * 1024 * 1024) return setError({ text: "Invoice must be under 5 MB.", retry: false });
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return setError({ text: "Use a PDF, JPG, PNG or WebP invoice.", retry: false });
    setBusy(true);
    try {
      const r = await extract({ data: { societyId, fileName: file.name, fileBase64: await toB64(file) } });
      const rows: InvoiceExtractionRow[] = await qc.fetchQuery({ queryKey: ["invoice-ai", societyId], queryFn: () => listFn({ data: { societyId } }) });
      if (r.ok) { setReview(rows.find((x) => x.id === r.id) ?? null); }
      else setError({ text: r.message, retry: ["ai_unavailable", "timeout", "rate_limited"].includes(r.code) });
    } catch {
      setError({ text: "Invoice reading is unavailable right now. You can still post the expense by hand below.", retry: true });
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  return (
    <SectionCard title={tu("op.read_an_invoice_with_ai")} description={tu("op.upload_a_vendor_invoice_ai")}>
      <div className="space-y-4">
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id="invoice-ai-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            {busy ? tu("op.reading_invoice") : tu("op.upload_invoice")}
          </Button>
          <p className="text-xs text-muted-foreground">{tu("op.pdf_or_photo_up_to")}</p>
        </div>
        {busy && <p role="status" className="text-sm text-muted-foreground">{tu("op.processing_this_can_take_up")}</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" /><span className="flex-1">{error.text}</span>
            {error.retry && lastFile && <Button size="sm" variant="outline" className="min-h-11" onClick={() => run(lastFile)}>{tu("common.tryAgain")}</Button>}
          </div>
        )}
        {review && <ReviewForm key={review.id} row={review} societyId={societyId} vendors={vendors} onDone={() => { setReview(null); void qc.invalidateQueries({ queryKey: ["invoice-ai", societyId] }); void qc.invalidateQueries({ queryKey: ["finance-expenses", societyId] }); }} />}
        {list.error ? <p className="text-sm text-muted-foreground">{tu("op.recent_invoices_unavailable")} <button className="underline" onClick={() => list.refetch()}>{tu("common.retry")}</button></p>
          : list.data && list.data.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {list.data.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, variant: "outline" as const };
              const reviewable = r.status === "extracted" || r.status === "needs_review";
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{String(r.extracted?.vendor_name ?? "") || r.original_name}</p>
                    <p className="text-xs text-muted-foreground">{[r.invoice_number && `#${r.invoice_number}`, new Date(r.created_at).toLocaleDateString("en-IN")].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    {reviewable && <Button size="sm" variant="outline" className="min-h-11" onClick={() => setReview(r)}>{tu("nd.review")}</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function ReviewForm({ row, societyId, vendors, onDone }: { row: InvoiceExtractionRow; societyId: string; vendors: Vendor[]; onDone: () => void }) {
  const f = (row.extracted ?? {}) as Partial<InvoiceFields> & { uncertain?: string[] };
  const uncertain = new Set(f.uncertain ?? []);
  const confirmFn = useServerFn(confirmInvoiceExtraction);
  const rejectFn = useServerFn(rejectInvoiceExtraction);
  const fileFn = useServerFn(getInvoiceFileUrl);
  const procFn = useServerFn(listLinkableProcurement);
  const proc = useQuery({ queryKey: ["invoice-ai-proc", societyId], queryFn: () => procFn({ data: { societyId } }), retry: false });
  const guessVendor = vendors.find((v) => f.vendor_name && v.name.toLowerCase().includes(f.vendor_name.toLowerCase().split(" ")[0] ?? "~"));
  const today = new Date().toISOString().slice(0, 10);
  const [requestId] = useState(() => crypto.randomUUID());
  const [vendorId, setVendorId] = useState(guessVendor?.id ?? "none");
  const [category, setCategory] = useState<string>(f.category_hint ?? "");
  const [amount, setAmount] = useState(f.total ?? "");
  const [date, setDate] = useState(f.invoice_date && f.invoice_date <= today ? f.invoice_date : "");
  const [invoiceNo, setInvoiceNo] = useState(f.invoice_number ?? "");
  const [method, setMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [desc, setDesc] = useState([f.vendor_name, f.invoice_number && `Invoice ${f.invoice_number}`, f.description].filter(Boolean).join(" — ").slice(0, 500));
  const [procId, setProcId] = useState("none");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const valid = !!category && /^\d{1,9}(\.\d{1,2})?$/.test(amount) && n > 0 && !!date && date <= today;
  const flag = (k: string) => uncertain.has(k) ? <Badge variant="destructive" className="ml-2">{tu("inc.rc.review")}</Badge> : null;

  async function confirm() {
    if (!valid) return;
    setBusy(true);
    try {
      await confirmFn({ data: { id: row.id, requestId, vendorId: vendorId === "none" ? null : vendorId, category: category as (typeof EXPENSE_CATEGORIES)[number],
        amount: n, expenseDate: date, paymentMethod: method, description: desc.trim() || null, invoiceNumber: invoiceNo.trim() || null, procurementRequestId: procId === "none" ? null : procId } });
      toast.success(tu("op.expense_posted_from_the_reviewed"));
      onDone();
    } catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await rejectFn({ data: { id: row.id, reason } }); toast.success(tu("op.invoice_discarded_no_expense_created")); onDone(); }
    catch (e) { toast.error(msg(e)); } finally { setBusy(false); }
  }
  async function openFile() {
    try { const { url } = await fileFn({ data: { id: row.id } }); window.open(url, "_blank", "noopener,noreferrer"); } catch { toast.error(tu("op.couldn_t_open_the_invoice")); }
  }

  const sel = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium"><ScanText className="h-4 w-4" /> {tu("op.review_extracted_details")}</p>
        <Button size="sm" variant="ghost" className="min-h-11" onClick={openFile}><ExternalLink className="mr-1 h-4 w-4" />{tu("op.view_invoice")}</Button>
      </div>
      {row.status === "needs_review" && <p role="status" className="rounded-lg bg-destructive/10 p-2 text-sm">{tu("op.needs_review_some_details_were")}</p>}
      {row.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{row.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {(["vendor_name", "vendor_gstin", "vendor_pan", "subtotal", "cgst", "sgst", "igst", "gst_rate", "tds_amount", "tds_section", "due_date", "currency"] as const).map((k) => (
          <div key={k}><dt className="text-xs text-muted-foreground">{fieldLabel(k)}{uncertain.has(k) && " ⚠"}</dt><dd className="break-words">{f[k] == null ? tu("financeErr.not_found.title") : String(f[k])}</dd></div>
        ))}
      </dl>
      {f.line_items && f.line_items.length > 0 && (
        <ul className="rounded-lg border text-sm">{f.line_items.map((l, i) => <li key={i} className="flex justify-between gap-2 border-b px-3 py-1.5 last:border-0"><span className="min-w-0 break-words">{l.description}</span><span className="tabular-nums">{l.amount ?? "—"}</span></li>)}</ul>
      )}
      <p className="text-xs text-muted-foreground">{tu("op.gst_tds_details_are_shown")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ia-amt">{tu("acc.amountInr")}{flag("total")}</Label><Input id="ia-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></div>
        <div><Label htmlFor="ia-date">{tu("doc.expenseDate")}{flag("invoice_date")}</Label><Input id="ia-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><Label htmlFor="ia-cat">{tu("common.category")}{!f.category_hint && <Badge variant="outline" className="ml-2">{tu("common.choose")}</Badge>}</Label>
          <select id="ia-cat" className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{tu("op.select")}</option>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
        <div><Label htmlFor="ia-ven">{tu("vs.cat.vendor")}{flag("vendor_name")}</Label>
          <select id="ia-ven" className={sel} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="none">{tu("exp.noVendor")}</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><Label htmlFor="ia-inv">{tu("op.invoice_number")}{flag("invoice_number")}</Label><Input id="ia-inv" maxLength={40} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
        <div><Label htmlFor="ia-pm">{tu("acc.paymentMethod")}</Label>
          <select id="ia-pm" className={sel} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="bank_transfer">{tu("common.bankTransfer")}</option><option value="cash">{tu("common.cash")}</option></select></div>
        <div className="sm:col-span-2"><Label htmlFor="ia-proc">{tu("op.link_to_purchase_request_optional")}</Label>
          <select id="ia-proc" className={sel} value={procId} onChange={(e) => setProcId(e.target.value)}>
            <option value="none">{tu("el.a.none")}</option>{(proc.data ?? []).map((p) => <option key={p.id} value={p.id}>#{p.request_no} {p.title}</option>)}</select></div>
        <div className="sm:col-span-2"><Label htmlFor="ia-desc">{tu("common.description")}</Label><Textarea id="ia-desc" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      </div>

      {rejecting ? (
        <div className="space-y-2">
          <Label htmlFor="ia-rej">{tu("op.why_discard_this_invoice")}</Label>
          <Input id="ia-rej" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="destructive" className="min-h-11" disabled={busy || reason.trim().length < 3} onClick={reject}><XCircle className="mr-2 h-4 w-4" />{tu("common.discard")}</Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setRejecting(false)}>{tu("common.back")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={busy || !valid} onClick={confirm}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{tu("op.confirm_post_expense")}</Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setRejecting(true)}>{tu("common.discard")}</Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onDone}>{tu("op.later")}</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tu("op.confirming_creates_one_expense_and")}</p>
    </div>
  );
}
