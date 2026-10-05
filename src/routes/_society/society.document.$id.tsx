import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFinanceDocument } from "@/lib/accounts-documents.functions";

export const Route = createFileRoute("/_society/society/document/$id")({
  head: () => ({ meta: [
    { title: "Bill / Voucher — SociyoHub" },
    { name: "description", content: "Printable society income bill or expense voucher." },
    { property: "og:title", content: "Bill / Voucher — SociyoHub" },
    { property: "og:description", content: "Printable society income bill or expense voucher." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DocumentPage,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmtDate = (s: string | null) => s ? new Date(s.length === 10 ? `${s}T12:00:00+05:30` : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
const method = (m: string | null) => m === "bank_transfer" ? "Bank transfer" : m === "cash" ? "Cash" : m ? m.replace(/_/g, " ") : "—";

function DocumentPage() {
  const { id } = Route.useParams();
  const fetchDoc = useServerFn(getFinanceDocument);
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const q = useQuery({ queryKey: ["finance-document", id], queryFn: () => fetchDoc({ data: { documentId: id } }), retry: false, enabled: validId });

  if (validId && q.isLoading) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="animate-spin" aria-label="Loading document" /></div>;
  if (!validId || q.error || !q.data) return <div className="mx-auto max-w-md space-y-3 p-6 text-center">
    <p className="text-sm" role="alert">{validId && q.error ? "This document couldn't load. Please try again." : "Document not found, or you don't have access to it."}</p>
    <div className="flex justify-center gap-2">{q.error && <Button variant="outline" onClick={() => q.refetch()}>Retry</Button>}<Button asChild variant="outline"><Link to="/society/vouchers">Back</Link></Button></div>
  </div>;

  const d = q.data;
  const isBill = d.kind === "bill";
  const title = isBill ? "INCOME BILL" : "EXPENSE VOUCHER";
  const rows: [string, string][] = [
    [isBill ? "Bill no." : "Voucher no.", d.document_no],
    [isBill ? "Bill date" : "Voucher date", fmtDate(d.issued_at)],
    [isBill ? "Income date" : "Expense date", fmtDate(d.entry_date)],
    ["Category", d.category ?? "—"],
    ...(d.vendor ? [["Paid to", d.vendor] as [string, string]] : []),
    [isBill ? "Received by" : "Paid by", method(d.payment_method)],
    ...(d.reference ? [["Reference", d.reference] as [string, string]] : []),
    ["Status", d.state],
  ];

  return <div className="min-h-screen bg-muted/30 px-3 py-4 print:bg-background print:p-0">
    <div className="mx-auto mb-3 flex max-w-2xl items-center justify-between gap-2 print:hidden">
      <Button asChild variant="outline" className="min-h-11"><Link to="/society/vouchers"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <Button className="min-h-11" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print / Save PDF</Button>
    </div>
    <article className="mx-auto max-w-2xl rounded-2xl border bg-card p-5 text-card-foreground shadow-sm sm:p-8 print:rounded-none print:border-0 print:shadow-none">
      <header className="flex items-start gap-3 border-b pb-4">
        {d.society.logo_url && <img src={d.society.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-contain" />}
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-heading text-lg font-bold sm:text-xl">{d.society.name}</h1>
          {(d.society.address || d.society.city) && <p className="break-words text-xs text-muted-foreground">{[d.society.address, d.society.city].filter(Boolean).join(", ")}</p>}
        </div>
      </header>
      <div className="my-5 text-center">
        <p className="inline-block rounded-md border-2 border-primary px-4 py-1 text-sm font-bold tracking-widest text-primary">{title}</p>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1.5 sm:block sm:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="break-words [overflow-wrap:anywhere] text-right font-medium sm:text-left">{v}</dd></div>)}
      </dl>
      <table className="mt-6 w-full table-fixed border-collapse text-sm">
        <thead><tr className="border-y bg-muted/50"><th className="p-2 text-left font-semibold">Particulars</th><th className="w-28 p-2 text-right font-semibold sm:w-36">Amount</th></tr></thead>
        <tbody><tr className="border-b align-top"><td className="break-words p-2">{d.category ?? (isBill ? "Income" : "Expense")}{d.description && <span className="block text-xs text-muted-foreground">{d.description}</span>}</td><td className="whitespace-nowrap p-2 text-right tabular-nums">{d.amount != null ? INR.format(d.amount) : "—"}</td></tr></tbody>
        <tfoot><tr className="border-b-2"><td className="p-2 text-right font-bold">Total</td><td className="whitespace-nowrap p-2 text-right text-base font-bold tabular-nums">{d.amount != null ? INR.format(d.amount) : "—"}</td></tr></tfoot>
      </table>
      {isBill && d.state !== "Payment verified" && <p className="mt-4 rounded-lg bg-muted p-3 text-xs">This bill is not proof of payment. Payment is shown as received only after the society verifies it.</p>}
      <footer className="mt-10 flex items-end justify-between gap-4 text-xs text-muted-foreground">
        <p>Computer-generated document · SociyoHub</p>
        <p className="border-t pt-1 text-center">Authorised signatory</p>
      </footer>
    </article>
  </div>;
}
