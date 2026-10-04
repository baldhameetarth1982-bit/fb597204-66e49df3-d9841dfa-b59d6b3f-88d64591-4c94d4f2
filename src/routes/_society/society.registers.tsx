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

  const PAGE = 200;
  const [pages, setPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setPages(1); }, [section, search]);
  const fetchPage = async (offset: number) => {
    const { data, error } = await supabase.rpc("get_society_register", { _section: section, _search: search, _offset: offset });
    if (error) throw error;
    return (data ?? []) as Row[];
  };

  const q = useQuery({
    queryKey: ["register", section, search, pages],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const out: Row[] = [];
      for (let p = 0; p < pages; p++) {
        const chunk = await fetchPage(p * PAGE);
        out.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      return out;
    },
  });
  const rows = q.data ?? [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const hasMore = rows.length > 0 && rows.length === pages * PAGE;

  async function exportCsv() {
    if (!rows.length || exporting) return;
    setExporting(true);
    try {
      // Fetch every page (capped) so the file is the full register, not just what's on screen.
      const all: Row[] = [];
      for (let offset = 0; offset < 10000; offset += PAGE) {
        const chunk = await fetchPage(offset);
        all.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      const { error } = await supabase.rpc("log_register_export", { _section: section, _rows: all.length });
      if (error) { toast.error("Export not allowed."); return; }
      const headers = Object.keys(all[0] ?? rows[0]);
      const csv = [headers.map(label).map(cell).join(","), ...all.map((r) => headers.map((c) => cell(r[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `${section}-register.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success(`Exported ${all.length} entr${all.length === 1 ? "y" : "ies"}.`);
    } catch {
      toast.error("Couldn't export this register. Please try again.");
    } finally { setExporting(false); }
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
        <Button variant="outline" className="min-h-11" disabled={!rows.length || exporting} onClick={() => void exportCsv()}><Download className="mr-1 h-4 w-4" />{exporting ? "Exporting…" : "Export"}</Button>
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Loading register…</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>Couldn't load this register.</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>Try again</Button></div>
        : rows.length === 0 ? <p className="rounded-lg border p-6 text-center text-muted-foreground">No entries found.</p>
        : <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{label(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{cols.map((c) => <td key={c} className="px-3 py-2 align-top">{show(r[c])}</td>)}</tr>)}</tbody>
          </table>
          {hasMore && <div className="flex items-center justify-between gap-2 p-3"><span className="text-xs text-muted-foreground">Showing {rows.length} entries.</span><Button variant="outline" size="sm" className="min-h-11" disabled={q.isFetching} onClick={() => setPages((p) => p + 1)}>{q.isFetching ? "Loading…" : "Show more"}</Button></div>}
        </div>}
    </PageShell>
  );
}
