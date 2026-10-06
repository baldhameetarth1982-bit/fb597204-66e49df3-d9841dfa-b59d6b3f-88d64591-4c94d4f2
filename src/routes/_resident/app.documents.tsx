import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, HelpCircle, Landmark, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ListEmpty, ListSkeleton, LoadError, SearchField, SegmentedFilter } from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { useTranslation } from "react-i18next";
import i18n, { localeTag } from "@/lib/i18n";
import { listResidentKnowledge, openKnowledgeDocument, listMyLeases, openMyLease } from "@/lib/society-knowledge.functions";

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

// Server sends fixed English; show it in the chosen language. Access is still decided by the server.
const SERVER_MSG: Record<string, string> = {
  "Couldn't load documents. Please try again.": "dc.loadFailRetry",
  "Join a society to see its documents.": "dc.joinFirst",
  "Too many requests. Please try again later.": "dc.tooMany",
  "This document isn't available.": "dc.notAvail",
  "This document isn't available right now.": "dc.notAvailNow",
  "Couldn't load your lease.": "dc.leaseLoadFail",
  "This lease isn't available.": "dc.leaseNA",
  "This lease isn't available right now.": "dc.leaseNANow",
};
const srvMsg = (m: string | undefined, fallbackKey: string) => i18n.t(m && SERVER_MSG[m] ? SERVER_MSG[m] : m ? m : fallbackKey);
const dateOpts = { day: "numeric", month: "short", year: "numeric", numberingSystem: "latn" } as Intl.DateTimeFormatOptions;

function DocumentsScreen() {
  const { t } = useTranslation();
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
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(localeTag(), dateOpts);

  async function open(id: string) {
    setOpening(id);
    const r = await openFn({ data: { id } }).catch(() => null);
    setOpening(null);
    if (!r?.ok) return toast.error(srvMsg(r?.message, "dc.notAvailAsk"));
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  const docRow = (d: (typeof items)[number]) => (
    <li key={d.id} className="flex items-center gap-3 px-4 py-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-container text-primary-container-foreground">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug break-words">{d.title}</p>
        <p className="text-xs text-muted-foreground">{[d.fileType, fmtSize(d.sizeBytes), t("dc.updated", { d: fmtDate(d.updatedAt) })].filter(Boolean).join(" · ")}</p>
      </div>
      <Button size="sm" variant="outline" className="min-h-11 shrink-0" disabled={opening === d.id} onClick={() => open(d.id)} aria-label={t("dc.openNamed", { name: d.title })}>
        {opening === d.id ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ExternalLink className="h-4 w-4 sm:me-1" />}
        <span className="hidden sm:inline">{t("common.open")}</span>
      </Button>
    </li>
  );

  const showDocs = tab !== "faq";
  const showFaqs = tab !== "document";
  const restDocs = docs.filter((d) => !recentIds.has(d.id));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 space-y-5">
      <header className="flex items-start gap-2">
        <Link to="/app/comm" aria-label={t("sec.backAria")} className="-ms-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-5 w-5 rtl:rotate-180" /></Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("sec.docsFaqs")}</h1>
          <p className="text-sm text-muted-foreground">{t("dc.subtitle")}</p>
        </div>
      </header>

      <MyLeaseSection />

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || (res && !res.ok) ? (
        <LoadError title={res && !res.ok ? srvMsg(res.message, "dc.loadFail") : t("dc.loadFail")} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <ListEmpty icon={FileText} title={t("dc.emptyTitle")}>{t("dc.emptyDesc")}</ListEmpty>
      ) : (
        <>
          <div className="space-y-3">
            <SearchField value={search} onChange={setSearch} placeholder={t("dc.search")} label={t("dc.search")} />
            <SegmentedFilter label={t("dc.show")} value={tab} onChange={setTab} options={[
              { key: "all", label: t("common.all"), count: items.length },
              { key: "document", label: t("home.qa.documents"), count: nDocs },
              { key: "faq", label: t("dc.faqs"), count: nFaqs },
            ]} />
          </div>

          {(showDocs ? docs.length : 0) + (showFaqs ? faqs.length : 0) === 0 ? (
            <ListEmpty icon={Search} title={t("dc.noMatch")}>{needle ? t("dc.noMatchQ", { q: search.trim() }) : t("dc.sectionEmpty")}</ListEmpty>
          ) : (
            <>
              {recent.length > 0 && (
                <section aria-labelledby="doc-recent">
                  <SectionLabel id="doc-recent">{t("dc.recent")}</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{recent.map(docRow)}</ul>
                </section>
              )}
              {showDocs && restDocs.length > 0 && (
                <section aria-labelledby="doc-all">
                  <SectionLabel id="doc-all">{recent.length > 0 ? t("dc.allDocs") : t("home.qa.documents")}</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{restDocs.map(docRow)}</ul>
                </section>
              )}
              {showFaqs && faqs.length > 0 && (
                <section aria-labelledby="doc-faq">
                  <SectionLabel id="doc-faq">{t("dc.faqTitle")}</SectionLabel>
                  <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                    {faqs.map((f) => {
                      const isOpen = expanded === f.id;
                      return (
                        <li key={f.id}>
                          <button type="button" aria-expanded={isOpen} aria-controls={`faq-${f.id}`} onClick={() => setExpanded(isOpen ? null : f.id)}
                            className="flex w-full min-h-12 items-center gap-3 px-4 py-3 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <HelpCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            <span className="flex-1 font-medium break-words">{f.title}</span>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                          </button>
                          {isOpen && <p id={`faq-${f.id}`} className="px-4 pb-4 ps-12 text-sm leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{f.answer}</p>}
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
            <span className="min-w-0 flex-1 text-sm"><span className="block font-medium">{t("dc.cantFind")}</span><span className="block text-muted-foreground">{t("dc.askAi")}</span></span>
            <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" aria-hidden />
          </Link>
        </>
      )}
    </div>
  );
}

function MyLeaseSection() {
  const { t } = useTranslation();
  const list = useServerFn(listMyLeases);
  const openFn = useServerFn(openMyLease);
  const [opening, setOpening] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["my-leases"], queryFn: () => list(), staleTime: 60_000 });
  const items = q.data?.ok ? q.data.items : [];
  if (items.length === 0) return null;
  async function open(id: string) {
    setOpening(id);
    const r = await openFn({ data: { id } }).catch(() => null);
    setOpening(null);
    if (!r?.ok) return toast.error(srvMsg(r?.message, "dc.leaseNA"));
    window.open(r.url, "_blank", "noopener,noreferrer");
  }
  return (
    <section aria-labelledby="my-lease">
      <SectionLabel id="my-lease">{t("dc.myLease")}</SectionLabel>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {items.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{l.title}</p>
              <p className="text-xs text-muted-foreground">{[l.flatNumber && t("dc.home", { n: l.flatNumber }), `v${l.version}`, l.expiresOn && t("dc.ends", { d: new Date(l.expiresOn).toLocaleDateString(localeTag(), dateOpts) })].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="outline" className="min-h-11" disabled={opening === l.id} onClick={() => open(l.id)}>
              {opening === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4 me-1" />}{t("common.open")}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">{t("dc.leasePrivate")}</p>
    </section>
  );
}
