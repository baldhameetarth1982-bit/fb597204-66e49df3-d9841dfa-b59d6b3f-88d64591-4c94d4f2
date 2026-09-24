import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronLeft, ExternalLink, FileText, HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

function DocumentsScreen() {
  const list = useServerFn(listResidentKnowledge);
  const openFn = useServerFn(openKnowledgeDocument);
  const [opening, setOpening] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["resident-knowledge"], queryFn: () => list(), staleTime: 60_000 });
  const res = q.data;
  const items = res?.ok ? res.items : [];
  const docs = items.filter((i) => i.kind === "document");
  const faqs = items.filter((i) => i.kind === "faq");

  async function open(id: string) {
    setOpening(id);
    const r = await openFn({ data: { id } }).catch(() => null);
    setOpening(null);
    if (!r?.ok) return toast.error(r?.message ?? "This document isn't available.");
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="px-5 py-6 space-y-6 pb-24 max-w-2xl mx-auto">
      <header className="flex items-center gap-3">
        <Link to="/app/secretary" aria-label="Back to AI Secretary" className="h-11 w-11 grid place-items-center rounded-xl hover:bg-accent"><ChevronLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents & FAQs</h1>
          <p className="text-sm text-muted-foreground">Published by your society committee.</p>
        </div>
      </header>

      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : q.isError || (res && !res.ok) ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">{res && !res.ok ? res.message : "Couldn't load documents."}</p>
          <Button variant="outline" className="min-h-11" onClick={() => q.refetch()}><RefreshCw className="h-4 w-4 mr-1.5" /> Try again</Button>
        </CardContent></Card>
      ) : items.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center space-y-2">
          <FileText className="h-7 w-7 mx-auto text-muted-foreground" />
          <p className="font-medium">Nothing published yet</p>
          <p className="text-sm text-muted-foreground">Your committee hasn't shared documents or FAQs yet.</p>
        </CardContent></Card>
      ) : (
        <>
          {docs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">Documents</h2>
              {docs.map((d) => (
                <Card key={d.id} className="rounded-2xl"><CardContent className="p-4 flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{d.title}</p>
                    <p className="text-xs text-muted-foreground">Updated {new Date(d.updatedAt).toLocaleDateString("en-IN")}</p>
                  </div>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={opening === d.id} onClick={() => open(d.id)}>
                    {opening === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-1" />} Open
                  </Button>
                </CardContent></Card>
              ))}
            </section>
          )}
          {faqs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">Frequently asked questions</h2>
              {faqs.map((f) => (
                <Card key={f.id} className="rounded-2xl"><CardContent className="p-0">
                  <button type="button" aria-expanded={expanded === f.id} onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                    className="w-full min-h-11 p-4 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
                    <HelpCircle className="h-5 w-5 text-primary shrink-0" />
                    <span className="flex-1 font-medium break-words">{f.title}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded === f.id ? "rotate-180" : ""}`} />
                  </button>
                  {expanded === f.id && <p className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{f.answer}</p>}
                </CardContent></Card>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
