import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Megaphone, Siren, ChevronRight, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { commErrorMessage } from "@/lib/notices";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { localeTag } from "@/lib/i18n";
import { NOTICE_CATEGORIES, liveAt, noticeCategory, type NoticeRow } from "@/lib/notices";
import { useResidentNotices, markNoticeRead, acknowledgeNotice } from "@/hooks/useResidentNotices";
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

const fmt = (n: NoticeRow) => new Date(liveAt(n) ?? n.created_at).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric" });

function NoticesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useResidentNotices();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState<NoticeRow | null>(null);

  const notices = q.data?.notices ?? [];
  const read = q.data?.read ?? new Set<string>();
  const acked = q.data?.acked ?? new Set<string>();
  const [acking, setAcking] = useState(false);
  async function ack(id: string) {
    setAcking(true);
    try { await acknowledgeNotice(id); toast.success(t("rn.ackDone")); await qc.invalidateQueries({ queryKey: ["resident-notices"] }); }
    catch (e) { toast.error(commErrorMessage(e)); }
    finally { setAcking(false); }
  }
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
          meta={<><span className={cn("rounded px-1.5 py-0.5 font-medium", c.className)}>{c.label}</span>{n.priority === "urgent" && <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">{t("notif.urgent")}</span>}{n.requires_ack && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{acked.has(n.id) ? t("rn.acknowledged") : t("rn.pleaseAck")}</span>}<span>{fmt(n)}</span></>}
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
      <CommHeader title={t("home.notices")} subtitle={t("rn.subtitle")} />

      {emergencies.length > 0 && (
        <section aria-label={t("rn.emergencyList")} className="mb-5 space-y-2">
          {emergencies.map((n) => (
            <button key={n.id} onClick={() => openNotice(n)}
              className="flex w-full items-center gap-3 rounded-2xl bg-destructive p-4 text-left text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Siren className="h-6 w-6 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide">{t("rn.emergencyOn", { date: fmt(n) })}</span>
                <span className="block font-semibold">{n.title}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
            </button>
          ))}
        </section>
      )}

      <div className="mb-4 space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder={t("rn.search")} label={t("rn.search")} />
        <div role="radiogroup" aria-label={t("rn.type")} className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {[{ value: "all", label: t("common.all") }, ...NOTICE_CATEGORIES].map((c) => (
            <button key={c.value} role="radio" aria-checked={cat === c.value} onClick={() => setCat(c.value)}
              className={cn("min-h-11 shrink-0 rounded-xl border px-3 text-sm font-medium",
                cat === c.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground")}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? <ListSkeleton rows={4} />
        : q.isError ? <LoadError title={t("rn.loadFailed")} onRetry={() => q.refetch()} />
        : filtered.length === 0 ? (
          <ListEmpty icon={Megaphone} title={notices.length ? t("rn.noMatch") : t("rn.none")}>
            {notices.length ? t("rn.noMatchHint") : t("rn.noneHint")}
          </ListEmpty>
        ) : (
          <>
            {unread.length > 0 && (<><SectionLabel count={unread.length}>{t("common.unread")}</SectionLabel><RowList label={t("rn.unreadList")}>{unread.map(row)}</RowList></>)}
            {earlier.length > 0 && (<><SectionLabel>{t("rn.earlier")}</SectionLabel><RowList label={t("rn.earlierList")}>{earlier.map(row)}</RowList></>)}
          </>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[88vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 font-medium", noticeCategory(open.category).className)}>{noticeCategory(open.category).label}</span>
                  {new Date(liveAt(open) ?? open.created_at).toLocaleString(localeTag())}
                  {open.edited_at && ` · ${t("rn.edited")}`}
                </div>
                <SheetTitle className="text-left text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              <p className="py-3 text-sm leading-relaxed whitespace-pre-wrap">{open.body}</p>
              {open.requires_ack && (acked.has(open.id)
                ? <p className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />{t("rn.youAcked")}</p>
                : <Button className="h-12 w-full rounded-xl" disabled={acking} onClick={() => ack(open.id)}>{acking ? <Loader2 className="h-4 w-4 animate-spin" /> : t("rn.iHaveRead")}</Button>)}
              {open.expires_at && <p className="pt-2 text-xs text-muted-foreground">{t("rn.visibleUntil", { date: new Date(open.expires_at).toLocaleString(localeTag()) })}</p>}
            </>
          )}
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
