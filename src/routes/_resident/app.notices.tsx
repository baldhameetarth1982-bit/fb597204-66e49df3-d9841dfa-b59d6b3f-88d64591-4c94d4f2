import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Search, Siren } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { NOTICE_CATEGORIES, liveAt, noticeCategory, type NoticeRow } from "@/lib/notices";

export const Route = createFileRoute("/_resident/app/notices")({
  head: () => ({
    meta: [
      { title: "Notices — SociyoHub" },
      { name: "description", content: "Official notices and announcements from your society committee." },
    ],
  }),
  component: NoticesPage,
});

export const residentNoticesKey = (uid?: string) => ["resident-notices", uid] as const;

export function useResidentNotices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: residentNoticesKey(user?.id),
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      // RLS returns only live notices meant for this resident's home.
      const [n, r] = await Promise.all([
        supabase.from("notices").select("id, title, body, category, audience, block_id, status, publish_at, published_at, created_at, edited_at")
          .eq("status", "published").order("publish_at", { ascending: false }).limit(100),
        supabase.from("notice_reads").select("notice_id"),
      ]);
      if (n.error) throw n.error;
      return { notices: (n.data ?? []) as NoticeRow[], read: new Set((r.data ?? []).map((x) => x.notice_id as string)) };
    },
  });
}

export async function markNoticeRead(noticeId: string, userId: string) {
  await supabase.from("notice_reads").upsert({ notice_id: noticeId, user_id: userId }, { onConflict: "notice_id,user_id", ignoreDuplicates: true });
}

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

  function openNotice(n: NoticeRow) {
    setOpen(n);
    if (user && !read.has(n.id)) void markNoticeRead(n.id, user.id).then(() => qc.invalidateQueries({ queryKey: ["resident-notices"] }));
  }

  return (
    <div className="px-4 py-5 space-y-4 pb-28 max-w-2xl mx-auto">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notices</h1>
        <p className="text-sm text-muted-foreground">Official updates from your committee</p>
      </header>

      {emergencies.map((n) => (
        <button key={n.id} onClick={() => openNotice(n)} className="w-full text-left rounded-2xl bg-destructive text-destructive-foreground p-4 flex gap-3">
          <Siren className="h-6 w-6 shrink-0" />
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide">Emergency</p><p className="font-semibold">{n.title}</p></div>
        </button>
      ))}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search notices" className="pl-9 h-11 rounded-xl" placeholder="Search notices" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[{ value: "all", label: "All" }, ...NOTICE_CATEGORIES].map((c) => (
          <button key={c.value} onClick={() => setCat(c.value)}
            className={cn("min-h-11 px-4 rounded-full border text-sm whitespace-nowrap", cat === c.value ? "bg-primary text-primary-foreground border-primary" : "border-border")}>
            {c.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : q.isError ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">We couldn't load notices.</p>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => q.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center">
          <Megaphone className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{notices.length ? "No notices match." : "No notices from your committee yet."}</p>
        </CardContent></Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((n) => {
            const c = noticeCategory(n.category);
            const unread = !read.has(n.id);
            return (
              <li key={n.id}>
                <button onClick={() => openNotice(n)} className="w-full text-left">
                  <Card className={cn("rounded-2xl hover:bg-accent/40 transition-colors", unread && "border-primary/40")}>
                    <CardContent className="p-4 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", c.className)}>{c.label}</span>
                        <span className="text-[11px] text-muted-foreground">{new Date(liveAt(n) ?? n.created_at).toLocaleDateString()}</span>
                        {unread && <span className="ml-auto h-2.5 w-2.5 rounded-full bg-primary" aria-label="Unread" />}
                      </div>
                      <p className="font-semibold">{n.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
                    </CardContent>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto">
          {open && (
            <>
              <SheetHeader><SheetTitle className="text-left">{open.title}</SheetTitle></SheetHeader>
              <div className="py-3 space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", noticeCategory(open.category).className)}>{noticeCategory(open.category).label}</span>
                  {new Date(liveAt(open) ?? open.created_at).toLocaleString()}
                  {open.edited_at && " · edited"}
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{open.body}</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
