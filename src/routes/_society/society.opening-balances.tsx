import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Landmark, Loader2, Upload } from "lucide-react";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { useSocietyId } from "@/hooks/useSocietyId";
import { importOpeningBalances, listOpeningBalances, reviewOpeningBalance } from "@/lib/workstream7.functions";
import { pick, readSheetRows } from "@/lib/sheet-rows";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/opening-balances")({
  head: () => ({ meta: [
    { title: "Opening balances — SociyoHub" },
    { name: "description", content: "Import old dues per flat as unverified evidence and review them." },
    { property: "og:title", content: "Opening balances — SociyoHub" },
    { property: "og:description", content: "Import old dues per flat as unverified evidence and review them." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OpeningBalancesPage,
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" }> = {
  imported_unverified: { label: "Imported – unverified", tone: "warning" },
  confirmed: { label: "Confirmed by committee", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};
const REJECT: Record<string, string> = {
  unit_not_found: "flat not found", ambiguous_unit: "more than one flat matches", invalid_amount: "invalid amount",
  invalid_date: "invalid date", duplicate: "already imported",
};

function OpeningBalancesPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const list = useServerFn(listOpeningBalances);
  const imp = useServerFn(importOpeningBalances);
  const review = useServerFn(reviewOpeningBalance);
  const [msg, setMsg] = useState<string | null>(null);
  const key = ["opening-balances", societyId];
  const q = useQuery({ queryKey: key, enabled: !!societyId, queryFn: () => list({ data: { societyId: societyId! } }) });

  const importM = useMutation({
    mutationFn: async (f: File) => {
      const r = await readSheetRows(f);
      if (!r.ok) throw new Error(r.error);
      const rows = r.rows.map((x) => ({
        block: pick(x, "block", "structure", "wing", "tower").slice(0, 80),
        unit: pick(x, "unit", "flat", "flat_number", "flat_no").slice(0, 40),
        amount: pick(x, "amount", "opening_balance", "dues", "arrears").slice(0, 20),
        as_of: pick(x, "as_of", "date", "as_on").slice(0, 20),
      }));
      return imp({ data: { societyId: societyId!, requestId: crypto.randomUUID(), sourceRef: f.name.slice(0, 120), rows } });
    },
    onSuccess: (r) => {
      const rej = r.rejected.slice(0, 5).map((x) => `row ${x.row}: ${REJECT[x.code] ?? x.code}`).join("; ");
      setMsg(`${r.imported} imported as unverified.${r.rejected.length ? ` ${r.rejected.length} skipped (${rej}${r.rejected.length > 5 ? "…" : ""}).` : ""}`);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reviewM = useMutation({
    mutationFn: (v: { id: string; confirm: boolean }) => review({ data: v }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (<div className="pb-24">
    <MobileHero eyebrow="Migration" title="Opening balances" subtitle="Old dues from your previous records, kept as evidence. They never create payments, receipts or bills." icon={Landmark} variant="teal" />
    <div className="max-w-3xl space-y-4 px-4 pt-4 md:px-6">
      <SectionCard title="Import" description="CSV or Excel with columns Block, Flat, Amount, As of (YYYY-MM-DD). Values only; up to 5,000 rows.">
        <label className="inline-flex">
          <input type="file" accept=".csv,.xlsx" className="hidden" disabled={!societyId || importM.isPending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importM.mutate(f); e.target.value = ""; }} />
          <Button asChild variant="outline" className="min-h-11 rounded-xl"><span>
            {importM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Choose file
          </span></Button>
        </label>
        {msg && <p className="mt-3 text-sm">{msg}</p>}
      </SectionCard>

      <SectionCard title="Imported rows" description="Confirm after checking against your old records. Confirmed rows still stay separate from SociyoHub bills." bodyClassName="p-0">
        {q.isLoading && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
        {q.isError && <div className="p-4"><p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{(q.error as Error).message}</p>
          <Button className="mt-3 min-h-11" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>}
        {q.data && q.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing imported yet.</p>}
        {q.data && q.data.length > 0 && <ul className="divide-y">{q.data.map((r) => {
          const st = STATUS[r.status] ?? { label: r.status, tone: "warning" as const };
          return <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.unit || "—"}</p>
              <p className="text-xs text-muted-foreground">As of {r.as_of}{r.source_ref ? ` · ${r.source_ref}` : ""}</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
            {r.status === "imported_unverified" && <div className="flex gap-2">
              <Button size="sm" className="min-h-11" disabled={reviewM.isPending} onClick={() => reviewM.mutate({ id: r.id, confirm: true })}>Confirm</Button>
              <Button size="sm" variant="outline" className="min-h-11" disabled={reviewM.isPending} onClick={() => reviewM.mutate({ id: r.id, confirm: false })}>Reject</Button>
            </div>}
          </li>;
        })}</ul>}
      </SectionCard>
    </div>
  </div>);
}
