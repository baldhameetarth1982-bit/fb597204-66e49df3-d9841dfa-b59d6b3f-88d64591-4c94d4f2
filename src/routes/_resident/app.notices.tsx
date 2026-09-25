import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Megaphone, Siren, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { NOTICE_CATEGORIES, liveAt, noticeCategory, type NoticeRow } from "@/lib/notices";
import { useResidentNotices, markNoticeRead } from "@/hooks/useResidentNotices";
import { SearchField, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel, CommRow, RowList } from "@/components/comm/CommUI";

export const Route = createFileRoute("/_resident/app/notices")({
  head: () => ({
    meta: [
      { title: "Notices — SociyoHub" },
      { name: "description", content: "Official notices and announcements from your society committee." },
      { property: "og:title", content: "Notices — SociyoHub" },
      { property: "og:description", content: "Official notices and announcements from your society committee." },
    ],
  }),
  component: NoticesPage,
});

const fmt = (n: NoticeRow) => new Date(liveAt(n) ?? n.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function NoticesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useResidentNotices();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState<NoticeRow | null>(null);

  const notices = q.data?.notices ?? [];
  const read = q.data?.read ?? new Set<string>();
  const emergencies = notices.filter((n) => n.category === "emergency" && Date.now() - new Date(liveAt(n) ?? n.created_at).getTime() < 3 * 864e5);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return notices.filter((n) => (cat === "all" || n.category === cat) && (!s || `${n.title} ${n.body}`.toLowerCase().includes(s)));
  }, [notices, search, cat]);
  const unread = filtered.filter((n) => !read.has(n.id));
  const earlier = filtered.filter((n) => read.has(n.id));

  function openNotice(n: NoticeRow) {
    setOpen(n);
    if (user && !read.has(n.id)) void markNoticeRead(n.id, user.id).then(() => qc.invalidateQueries({ queryKey: ["resident-notices"] }));
  }

  const row = (n: NoticeRow) => {
    const c = noticeCategory(n.category);
    const em = n.category === "emergency";
    return (
      <li key={n.id}>
        <CommRow
          icon={em ? Siren : Megaphone}
          iconTone={em ? "danger" : "default"}
          edge={em ? "danger" : !read.has(n.id) ? "primary" : "none"}
          unread={!read.has(n.id)}
          meta={<><span className={cn("rounded px-1.5 py-0.5 font-medium", c.className)}>{c.label}</span><span>{fmt(n)}</span></>}
          title={n.title}
          body={n.body}
          trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          onClick={() => openNotice(n)}
        />
      </li>
    );
  };

  return (
    <CommPage>
      <CommHeader title="Notices" subtitle="Official updates from your committee" />

      {emergencies.length > 0 && (
        <section aria-label="Emergency notices" className="mb-5 space-y-2">
          {emergencies.map((n) => (
            <button key={n.id} onClick={() => openNotice(n)}
              className="flex w-full items-center gap-3 rounded-2xl bg-destructive p-4 text-left text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Siren className="h-6 w-6 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide">Emergency · {fmt(n)}</span>
                <span className="block font-semibold">{n.title}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
            </button>
          ))}
        </section>
      )}

      <div className="mb-4 space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder="Search notices" label="Search notices" />
        <div role="radiogroup" aria-label="Notice type" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {[{ value: "all", label: "All" }, ...NOTICE_CATEGORIES].map((c) => (
            <button key={c.value} role="radio" aria-checked={cat === c.value} onClick={() => setCat(c.value)}
              className={cn("min-h-11 shrink-0 rounded-xl border px-3 text-sm font-medium",
                cat === c.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground")}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? <ListSkeleton rows={4} />
        : q.isError ? <LoadError title="We couldn't load notices." onRetry={() => q.refetch()} />
        : filtered.length === 0 ? (
          <ListEmpty icon={Megaphone} title={notices.length ? "No notices match" : "No notices yet"}>
            {notices.length ? "Try another type or search." : "Your committee hasn't published any notices."}
          </ListEmpty>
        ) : (
          <>
            {unread.length > 0 && (<><SectionLabel count={unread.length}>Unread</SectionLabel><RowList label="Unread notices">{unread.map(row)}</RowList></>)}
            {earlier.length > 0 && (<><SectionLabel>Earlier</SectionLabel><RowList label="Earlier notices">{earlier.map(row)}</RowList></>)}
          </>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[88vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 font-medium", noticeCategory(open.category).className)}>{noticeCategory(open.category).label}</span>
                  {new Date(liveAt(open) ?? open.created_at).toLocaleString()}
                  {open.edited_at && " · edited"}
                </div>
                <SheetTitle className="text-left text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              <p className="py-3 text-sm leading-relaxed whitespace-pre-wrap">{open.body}</p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
