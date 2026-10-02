import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Download, FileCheck2, FileSpreadsheet, FileText, Loader2, RotateCw } from "lucide-react";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { AuditorExtrasSection } from "@/components/billing/AuditorExtrasSection";
import { ProcurementAuditSection, fyLabel } from "@/features/procurement/procurement";
const fyOf = (d: string) => { const [y, m] = d.split("-").map(Number); return (m ?? 4) >= 4 ? (y || new Date().getFullYear()) : (y || new Date().getFullYear()) - 1; };
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSocietyId } from "@/hooks/useSocietyId";
import { generateAuditorPack, type AuditorPack } from "@/lib/auditor-pack.functions";
import { SECTIONS, bankSummary, downloadBlob, packToCsv, packToPdf, sumBy } from "@/lib/auditor-pack";


const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const today = new Date().toISOString().slice(0, 10);
const fyStart = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();

type Format = "view" | "csv" | "pdf";

export function AuditorPackPage({ embedded = false }: { embedded?: boolean }) {
  const { societyId } = useSocietyId();
  const gen = useServerFn(generateAuditorPack);
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(today);
  const [pack, setPack] = useState<AuditorPack | null>(null);
  const periodError = !from || !to ? "Choose both dates." : from > to ? "Start date must be before end date." : to > today ? "End date can't be in the future." : (Date.parse(to) - Date.parse(from)) / 864e5 > 730 ? "Choose a period of two years or less." : null;

  const run = useMutation({
    mutationFn: async (format: Format) => {
      // Each export re-fetches from the server so it is authorised and audited with its own export type.
      const data = await gen({ data: { societyId: societyId!, from, to, format } });
      const base = `auditor-pack_${data.period.from}_${data.period.to}`;
      if (format === "csv") downloadBlob(new Blob([packToCsv(data)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
      if (format === "pdf") downloadBlob(await packToPdf(data), `${base}.pdf`);
      return data;
    },
    onSuccess: (data) => setPack(data),
  });
  const busy = run.isPending;
  const disabled = !societyId || !!periodError || busy;

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow="Accounts Center" title="Auditor pack" subtitle="A traceable evidence pack built from the same records as Reports and Reconciliation." icon={FileCheck2} variant="teal" />
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      {!embedded && <AccountsCenterTabs />}

      <SectionCard title="Reporting period" description="Up to two years. Defaults to the current financial year.">
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="ap-from">From</Label><Input id="ap-from" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="ap-to">To</Label><Input id="ap-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {periodError && <p role="alert" className="mt-2 text-sm text-destructive">{periodError}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={disabled} onClick={() => run.mutate("view")}>
            {busy && run.variables === "view" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}Prepare pack
          </Button>
          <Button className="min-h-11" variant="outline" disabled={disabled} onClick={() => run.mutate("pdf")}>
            {busy && run.variables === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Download PDF
          </Button>
          <Button className="min-h-11" variant="outline" disabled={disabled} onClick={() => run.mutate("csv")}>
            {busy && run.variables === "csv" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Download CSV
          </Button>
        </div>
        {busy && <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">Gathering records… large periods can take a few seconds.</p>}
      </SectionCard>

      <SectionCard title="Procurement & budget" description={`Budget vs actual and purchase requests for ${fyLabel(fyOf(from))}. Read-only.`} bodyClassName="p-0">
        {societyId && <ProcurementAuditSection fy={fyOf(from)} />}
      </SectionCard>

      <SectionCard title="Adjustments, opening balances & resolutions" description="For the selected period. Read-only; downloads are built on your device." bodyClassName="p-0">
        {societyId && <AuditorExtrasSection societyId={societyId} from={from} to={to} />}
      </SectionCard>

      {run.isError && !busy && <SectionCard icon={AlertCircle} title="Pack unavailable">
        <p className="text-sm text-destructive">{run.error instanceof Error ? run.error.message : "The Auditor Pack couldn't be generated."}</p>
        <Button className="mt-3 min-h-11" variant="outline" onClick={() => run.mutate(run.variables ?? "view")}><RotateCw className="mr-2 h-4 w-4" />Retry</Button>
      </SectionCard>}

      {!pack && !busy && !run.isError && <SectionCard title="What's included">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Opening and closing cash and bank position, income, expense and net movement from the posted journal.</li>
          <li>Collections, other income, expenses and bills with their current status — verified, pending, rejected or reversed shown separately.</li>
          <li>Outstanding dues ageing, bank reconciliation status, No-Dues certificates and financial activity history.</li>
          <li>Record IDs on every line so each figure can be traced back in SociyoHub. No phone numbers, emails or resident names.</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Nothing is changed or marked verified by preparing a pack. Files are created on your device and never stored online. Each pack is recorded in the audit log.</p>
      </SectionCard>}

      {pack && <PackView pack={pack} />}
    </div>
  </div>;
}

function PackView({ pack }: { pack: AuditorPack }) {
  const p = pack.position;
  const empty = SECTIONS.every((s) => pack[s.key].total === 0) && p.income === 0 && p.expense === 0;
  const bank = bankSummary(pack.bank.rows);
  return <>
    <SectionCard title={pack.society?.name ?? "Society"} description={`${pack.period.from} to ${pack.period.to} · generated ${new Date(pack.generated_at).toLocaleString("en-IN")}`}>
      {empty ? <p className="text-sm text-muted-foreground">No financial records in this period. Try a wider date range.</p> :
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Opening cash", p.opening_cash], ["Opening bank", p.opening_bank], ["Closing cash", p.closing_cash], ["Closing bank", p.closing_bank],
            ["Income", p.income], ["Expense", p.expense], ["Net movement", p.net_movement]].map(([k, v]) =>
            <div key={k as string} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="font-semibold tabular-nums break-words">{INR.format(v as number)}</p></div>)}
        </div>}
      <p className="mt-3 text-xs text-muted-foreground">Totals come from posted journal entries (reversals net off). Pending or rejected items are listed but never counted.</p>
    </SectionCard>

    <SectionCard title="Outstanding dues" description={`As of ${pack.period.to}`} bodyClassName="p-0">
      <ListCardGroup>{pack.ageing.length === 0 ? <ListCard title="No outstanding dues" /> : pack.ageing.map((a) =>
        <ListCard key={a.bucket} title={a.bucket === "current" ? "Current" : `${a.bucket.replace("_", "–").replace("plus", "+")} days`} subtitle={`${a.bill_count} bills`} trailing={<span className="font-semibold tabular-nums">{INR.format(a.amount)}</span>} />)}
      </ListCardGroup>
    </SectionCard>

    <SectionCard title="Bank reconciliation">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">Reconciled {bank.reconciledCount} · {INR.format(bank.reconciled)}</Badge>
        <Badge variant="outline">Unreconciled {bank.unreconciledCount} · {INR.format(bank.unreconciled)}</Badge>
      </div>
    </SectionCard>

    <SectionCard title="Sections" description="Status breakdown per section. Download CSV for every line." bodyClassName="p-0">
      <ListCardGroup>{SECTIONS.map((s) => {
        const sec = pack[s.key];
        const sums = s.amountField ? sumBy(sec.rows, s.amountField, s.statusField) : null;
        return <ListCard key={s.key} title={s.title}
          subtitle={sums ? `Verified ${INR.format(sums.verified)} · Pending ${INR.format(sums.pending)} · Reversed ${INR.format(sums.reversed)} · Rejected ${INR.format(sums.rejected)}` : undefined}
          trailing={<span className="text-sm tabular-nums">{sec.total}{sec.total > sec.rows.length ? ` (first ${sec.rows.length})` : ""}</span>} />;
      })}</ListCardGroup>
    </SectionCard>
    <p className="flex items-center gap-1 text-xs text-muted-foreground"><Download className="h-3 w-3" />Exports use the same server data shown here.</p>
  </>;
}
