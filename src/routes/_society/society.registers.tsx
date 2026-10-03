import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_society/society/registers")({
  head: () => ({
    meta: [
      { title: "Society registers — SociyoHub" },
      { name: "description", content: "Searchable member, occupancy, committee, meeting, resolution, election, notice and move registers." },
      { property: "og:title", content: "Society registers — SociyoHub" },
      { property: "og:description", content: "Read-only society registers built from existing records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegistersPage,
});

const SECTIONS = [
  ["members", "Members"], ["occupancy", "Occupancy history"], ["committee", "Committee"], ["meetings", "Meetings & attendance"],
  ["resolutions", "Resolutions"], ["elections", "Elections"], ["notices", "Notices"], ["moves", "Moves & passes"],
] as const;
type Row = Record<string, unknown>;
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const show = (v: unknown) => v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v).replace(/T.*$/, "");
// Neutralise spreadsheet formulas on export.
const cell = (v: unknown) => { let s = show(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };

function RegistersPage() {
  const [section, setSection] = useState<string>("members");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(input), 300); return () => clearTimeout(t); }, [input]);

  const q = useQuery({
    queryKey: ["register", section, search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_society_register", { _section: section, _search: search, _offset: 0 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const rows = q.data ?? [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];

  async function exportCsv() {
    if (!rows.length) return;
    const { error } = await supabase.rpc("log_register_export", { _section: section, _rows: rows.length });
    if (error) return toast.error("Export not allowed.");
    const csv = [cols.map(label).map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${section}-register.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <PageShell>
      <PageHeader title="Society registers" description="Read-only registers drawn from your existing records. History is never changed here. These are record-keeping aids, not a certification of legal compliance." />
      <div role="tablist" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(([k, l]) => (
          <Button key={k} role="tab" aria-selected={section === k} size="sm" variant={section === k ? "default" : "outline"} className="min-h-11 shrink-0" onClick={() => setSection(k)}>{l}</Button>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <Input aria-label="Search register" placeholder="Search…" className="h-11" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button variant="outline" className="min-h-11" disabled={!rows.length} onClick={() => void exportCsv()}><Download className="mr-1 h-4 w-4" />Export</Button>
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Loading register…</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>Couldn't load this register.</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>Try again</Button></div>
        : rows.length === 0 ? <p className="rounded-lg border p-6 text-center text-muted-foreground">No entries found.</p>
        : <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{label(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{cols.map((c) => <td key={c} className="px-3 py-2 align-top">{show(r[c])}</td>)}</tr>)}</tbody>
          </table>
          {rows.length === 200 && <p className="p-3 text-xs text-muted-foreground">Showing the latest 200 entries. Use search to narrow down.</p>}
        </div>}
    </PageShell>
  );
}
