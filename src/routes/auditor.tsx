import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BookOpenCheck, History, LogOut, Receipt } from "lucide-react";
import { RoleShell, Loading, ErrorRow } from "@/components/roles/RoleShell";
import { BooksPage } from "@/components/finance/BooksWorkspace";
import { AuditorPackPage } from "@/components/finance/AuditorPackWorkspace";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { getAuditorHistory } from "@/lib/role-access.functions";

export const Route = createFileRoute("/auditor")({
  head: () => ({ meta: [
    { title: "Auditor workspace — SociyoHub" },
    { name: "description", content: "Read-only access to a society's books, records, Auditor Pack and financial audit history." },
    { property: "og:title", content: "Auditor workspace — SociyoHub" },
    { property: "og:description", content: "Read-only financial audit access for society auditors." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: AuditorRoute,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };

function AuditorRoute() {
  return <RoleShell role="auditor">{(_a, societyName) => <AuditorWorkspace societyName={societyName} />}</RoleShell>;
}

function AuditorWorkspace({ societyName }: { societyName: string | null }) {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Auditor · read-only</p>
          <h1 className="text-2xl font-semibold">{societyName ?? "Society"} accounts</h1>
          <p className="text-sm text-muted-foreground">You can view and export audit information. Nothing here can be changed from this account.</p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={async () => { await signOut(); window.location.replace("/login"); }}><LogOut className="mr-1 h-4 w-4" />Sign out</Button>
      </header>
      <Tabs defaultValue="books">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="mb-4 min-w-max">
            <TabsTrigger value="books">Books &amp; tax</TabsTrigger>
            <TabsTrigger value="records">Records</TabsTrigger>
            <TabsTrigger value="pack">Auditor Pack</TabsTrigger>
            <TabsTrigger value="history">Audit history</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="books"><FeatureGate feature="accounts_center"><BooksPage readOnly /></FeatureGate></TabsContent>
        <TabsContent value="records"><RecordsTab /></TabsContent>
        <TabsContent value="pack"><FeatureGate feature="advanced_reports"><AuditorPackPage embedded /></FeatureGate></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

type Kind = "bills" | "payments" | "expenses" | "income";
const KIND_LABEL: Record<Kind, string> = { bills: "Bills", payments: "Payments", expenses: "Expenses", income: "Other income" };

function RecordsTab() {
  const { societyId } = useSocietyId();
  const [kind, setKind] = useState<Kind>("bills");
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(0);
  const valid = !!from && !!to && from <= to;
  const q = useQuery({
    queryKey: ["auditor-records", societyId, kind, from, to, page], enabled: !!societyId && valid, placeholderData: (p) => p,
    queryFn: async () => {
      const r0 = page * 50, r1 = r0 + 49;
      // Reads go through row-level security: only active auditors of this society can see these rows.
      if (kind === "bills") {
        const { data, error } = await supabase.from("bills").select("id, bill_number, period_label, bill_date, total_payable, amount, status")
          .eq("society_id", societyId!).gte("bill_date", from).lte("bill_date", to).order("bill_date", { ascending: false }).range(r0, r1);
        if (error) throw new Error("Could not load bills.");
        return data.map((b) => ({ id: b.id, date: b.bill_date, ref: b.bill_number ?? b.period_label, amount: Number(b.total_payable ?? b.amount), status: b.status }));
      }
      if (kind === "payments") {
        const { data, error } = await supabase.from("payments").select("id, payment_date, reference_no, method, amount, status")
          .eq("society_id", societyId!).gte("payment_date", from).lte("payment_date", to).order("payment_date", { ascending: false }).range(r0, r1);
        if (error) throw new Error("Could not load payments.");
        return data.map((p) => ({ id: p.id, date: p.payment_date, ref: [p.method, p.reference_no].filter(Boolean).join(" · "), amount: Number(p.amount), status: p.status }));
      }
      if (kind === "expenses") {
        const { data, error } = await supabase.from("expenses").select("id, spent_on, category, note, amount, status")
          .eq("society_id", societyId!).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).range(r0, r1);
        if (error) throw new Error("Could not load expenses.");
        return data.map((e) => ({ id: e.id, date: e.spent_on, ref: [e.category, e.note].filter(Boolean).join(" · "), amount: Number(e.amount), status: e.status }));
      }
      const { data, error } = await supabase.from("society_income_records").select("id, payment_date, reference_number, payment_method, amount, verification_status")
        .eq("society_id", societyId!).gte("payment_date", from).lte("payment_date", `${to}T23:59:59`).order("payment_date", { ascending: false }).range(r0, r1);
      if (error) throw new Error("Could not load income.");
      return data.map((i) => ({ id: i.id, date: i.payment_date.slice(0, 10), ref: [i.payment_method, i.reference_number].filter(Boolean).join(" · "), amount: Number(i.amount), status: i.verification_status }));
    },
  });
  return (
    <SectionCard title="Canonical records" description="Read-only. Totals in the books come from the posted ledger; these are the source records." icon={Receipt}>
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <Button key={k} size="sm" className="min-h-11" variant={kind === k ? "default" : "outline"} onClick={() => { setKind(k); setPage(0); }}>{KIND_LABEL[k]}</Button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div><Label htmlFor="rf">From</Label><Input id="rf" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></div>
        <div><Label htmlFor="rt">To</Label><Input id="rt" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></div>
      </div>
      {!valid ? <p role="alert" className="text-sm text-destructive">Choose a valid date range.</p>
        : q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} />
        : !q.data ? <Loading />
        : q.data.length === 0 ? <EmptyState icon={Receipt} title={`No ${KIND_LABEL[kind].toLowerCase()} in this period`} />
        : (
          <ul className="divide-y rounded-lg border">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0"><p className="font-medium">{r.date}</p><p className="truncate text-muted-foreground">{r.ref || "—"}</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{r.status}</Badge><span className="tabular-nums font-medium">{INR.format(r.amount)}</span></div>
              </li>
            ))}
          </ul>
        )}
      <div className="mt-3 flex justify-between">
        <Button variant="outline" size="sm" className="min-h-11" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" className="min-h-11" disabled={(q.data?.length ?? 0) < 50} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </SectionCard>
  );
}

function HistoryTab() {
  const fn = useServerFn(getAuditorHistory);
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(today);
  const [offset, setOffset] = useState(0);
  const valid = !!from && !!to && from <= to;
  const q = useQuery({ queryKey: ["auditor-history", from, to, offset], enabled: valid, retry: false, placeholderData: (p) => p, queryFn: () => fn({ data: { from, to, offset } }) });
  return (
    <SectionCard title="Financial audit history" description="Who changed which financial record, and when. Non-financial activity is not shown." icon={History}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div><Label htmlFor="hf">From</Label><Input id="hf" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} /></div>
        <div><Label htmlFor="ht">To</Label><Input id="ht" type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} /></div>
      </div>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? <EmptyState icon={BookOpenCheck} title="No financial activity in this period" /> : (
        <ul className="divide-y rounded-lg border">
          {q.data.map((h, i) => (
            <li key={`${h.at}-${i}`} className="p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{h.action.replace(/[._]/g, " ")}</span><span className="text-muted-foreground">{new Date(h.at).toLocaleString("en-IN")}</span></div>
              <p className="text-muted-foreground">{h.actor_name}{h.target_table ? ` · ${h.target_table.replace(/_/g, " ")}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex justify-between">
        <Button variant="outline" size="sm" className="min-h-11" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <Button variant="outline" size="sm" className="min-h-11" disabled={(q.data?.length ?? 0) < 50} onClick={() => setOffset(offset + 50)}>Next</Button>
      </div>
    </SectionCard>
  );
}
