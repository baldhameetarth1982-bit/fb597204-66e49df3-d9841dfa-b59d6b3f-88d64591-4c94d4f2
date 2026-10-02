import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, HelpCircle, Landmark, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ListEmpty, ListSkeleton, LoadError, SearchField, SegmentedFilter } from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { listResidentKnowledge, openKnowledgeDocument } from "@/lib/society-knowledge.functions";

export const Route = createFileRoute("/_resident/app/documents")({
  head: () => ({
    meta: [
      { title: "Society Documents & FAQs — SociyoHub" },
      { name: "description", content: "Read your society's published documents and frequently asked questions." },
      { property: "og:title", content: "Society Documents & FAQs — SociyoHub" },
      { property: "og:description", content: "Official society documents and answers to common questions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsScreen,
});

type Tab = "all" | "document" | "faq";

function DocumentsScreen() {
  const list = useServerFn(listResidentKnowledge);
  const openFn = useServerFn(openKnowledgeDocument);
  const [opening, setOpening] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const q = useQuery({ queryKey: ["resident-knowledge"], queryFn: () => list(), staleTime: 60_000 });
  const res = q.data;
  const items = res?.ok ? res.items : [];
  const needle = search.trim().toLowerCase();
  const matches = items.filter((i) => !needle || i.title.toLowerCase().includes(needle) || (i.answer ?? "").toLowerCase().includes(needle));
  const docs = matches.filter((i) => i.kind === "document");
  const faqs = matches.filter((i) => i.kind === "faq");
  const nDocs = items.filter((i) => i.kind === "document").length;
  const nFaqs = items.length - nDocs;
  const recent = !needle && tab === "all"
    ? [...items].filter((i) => i.kind === "document").sort((x, y) => +new Date(y.updatedAt) - +new Date(x.updatedAt)).slice(0, 3)
    : [];
  const recentIds = new Set(recent.map((r) => r.id));
  const fmtSize = (b: number | null) => (b == null ? null : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  async function open(id: string) {
    setOpening(id);
    const r = await openFn({ data: { id } }).catch(() => null);
    setOpening(null);
    if (!r?.ok) return toast.error(r?.message ?? "This document isn't available right now. Please try again or ask your committee.");
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  const docRow = (d: (typeof items)[number]) => (
    <li key={d.id} className="flex items-center gap-3 px-4 py-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-container text-primary-container-foreground">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug break-words">{d.title}</p>
        <p className="text-xs text-muted-foreground">{[d.fileType, fmtSize(d.sizeBytes), `Updated ${fmtDate(d.updatedAt)}`].filter(Boolean).join(" · ")}</p>
      </div>
      <Button size="sm" variant="outline" className="min-h-11 shrink-0" disabled={opening === d.id} onClick={() => open(d.id)} aria-label={`Open ${d.title}`}>
        {opening === d.id ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ExternalLink className="h-4 w-4 sm:mr-1" />}
        <span className="hidden sm:inline">Open</span>
      </Button>
    </li>
  );

  const showDocs = tab !== "faq";
  const showFaqs = tab !== "document";
  const restDocs = docs.filter((d) => !recentIds.has(d.id));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 space-y-5">
      <header className="flex items-start gap-2">
        <Link to="/app/comm" aria-label="Back to society" className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-5 w-5" /></Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Documents & FAQs</h1>
          <p className="text-sm text-muted-foreground">Official papers and answers published by your committee.</p>
        </div>
      </header>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || (res && !res.ok) ? (
        <LoadError title={res && !res.ok ? res.message : "Couldn't load documents."} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <ListEmpty icon={FileText} title="Nothing published yet">Your committee hasn't shared documents or FAQs yet.</ListEmpty>
      ) : (
        <>
          <div className="space-y-3">
            <SearchField value={search} onChange={setSearch} placeholder="Search documents and FAQs" label="Search documents and FAQs" />
            <SegmentedFilter label="Show" value={tab} onChange={setTab} options={[
              { key: "all", label: "All", count: items.length },
              { key: "document", label: "Documents", count: nDocs },
              { key: "faq", label: "FAQs", count: nFaqs },
            ]} />
          </div>

          {(showDocs ? docs.length : 0) + (showFaqs ? faqs.length : 0) === 0 ? (
            <ListEmpty icon={Search} title="No matches">{needle ? `Nothing matches “${search.trim()}”. Try a shorter word.` : "Nothing in this section yet."}</ListEmpty>
          ) : (
            <>
              {recent.length > 0 && (
                <section aria-labelledby="doc-recent">
                  <SectionLabel id="doc-recent">Recently updated</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{recent.map(docRow)}</ul>
                </section>
              )}
              {showDocs && restDocs.length > 0 && (
                <section aria-labelledby="doc-all">
                  <SectionLabel id="doc-all">{recent.length > 0 ? "All documents" : "Documents"}</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{restDocs.map(docRow)}</ul>
                </section>
              )}
              {showFaqs && faqs.length > 0 && (
                <section aria-labelledby="doc-faq">
                  <SectionLabel id="doc-faq">Frequently asked questions</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                    {faqs.map((f) => {
                      const isOpen = expanded === f.id;
                      return (
                        <li key={f.id}>
                          <button type="button" aria-expanded={isOpen} aria-controls={`faq-${f.id}`} onClick={() => setExpanded(isOpen ? null : f.id)}
                            className="flex w-full min-h-12 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <HelpCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            <span className="flex-1 font-medium break-words">{f.title}</span>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                          </button>
                          {isOpen && <p id={`faq-${f.id}`} className="px-4 pb-4 pl-12 text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{f.answer}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}

          <Link to="/app/secretary" className="flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Landmark className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 text-sm"><span className="block font-medium">Can't find it?</span><span className="block text-muted-foreground">Ask AI Secretary — it answers from these documents.</span></span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </>
      )}
    </div>
  );
}
