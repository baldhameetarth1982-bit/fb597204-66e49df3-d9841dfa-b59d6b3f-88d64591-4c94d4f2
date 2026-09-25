import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ShieldCheck, LifeBuoy, ParkingSquare, Inbox, Search, Megaphone, Receipt, Siren } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getLastSeen, markNotificationsSeen } from "@/hooks/useUnreadNotifications";
import { useResidentNotices, markNoticeRead } from "@/hooks/useResidentNotices";
import { liveAt, noticeCategory } from "@/lib/notices";
import { cn } from "@/lib/utils";
import { ListSkeleton, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel, RowList } from "@/components/comm/CommUI";

export const Route = createFileRoute("/_resident/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — SociyoHub" },
      { name: "description", content: "Society notices, bills, visitors, requests and parking updates in one place." },
    ],
  }),
  component: NotificationCenter,
});

type Cat = "all" | "notices" | "billing" | "visitors" | "helpdesk" | "parking";
interface Item {
  key: string; cat: Exclude<Cat, "all">; title: string; body: string | null; at: string; unread: boolean;
  to: string; icon: typeof Bell; emergency?: boolean; source: "personal" | "notice" | "bill"; refId: string;
}
const TABS: { v: Cat; label: string }[] = [
  { v: "all", label: "All" }, { v: "notices", label: "Notices" }, { v: "billing", label: "Bills" },
  { v: "visitors", label: "Visitors" }, { v: "helpdesk", label: "Requests" }, { v: "parking", label: "Parking" },
];
// Links only go to pages that re-check access themselves.
const PERSONAL: Record<string, { cat: Item["cat"]; icon: typeof Bell; to: string }> = {
  visitor_approval: { cat: "visitors", icon: ShieldCheck, to: "/app/visitors" },
  visitor_entered: { cat: "visitors", icon: ShieldCheck, to: "/app/visitors" },
  visitor_exited: { cat: "visitors", icon: ShieldCheck, to: "/app/visitors" },
  helpdesk: { cat: "helpdesk", icon: LifeBuoy, to: "/app/helpdesk" },
  parking: { cat: "parking", icon: ParkingSquare, to: "/app/vehicles" },
};

function NotificationCenter() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");
  const [lastSeen] = useState(() => getLastSeen());

  const personal = useQuery({
    enabled: !!user, queryKey: ["user-notifications", user?.id], staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_notifications")
        .select("id, kind, title, body, created_at, read_at").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const notices = useResidentNotices();
  const bills = useQuery({
    enabled: !!user, queryKey: ["notif-bills", user?.id], staleTime: 60_000,
    queryFn: async () => {
      // RLS: only bills for the resident's own homes.
      const { data, error } = await supabase.from("bills")
        .select("id, period_label, due_date, status, created_at, finalized_at")
        .neq("status", "cancelled").neq("status", "draft")
        .gte("created_at", new Date(Date.now() - 90 * 864e5).toISOString())
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => () => markNotificationsSeen(), []);
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`user-notifs-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["user-notifications"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const n of personal.data ?? []) {
      const m = PERSONAL[n.kind] ?? { cat: "helpdesk" as const, icon: Bell, to: "/app/dashboard" };
      out.push({ key: `p-${n.id}`, cat: m.cat, title: n.title, body: n.body, at: n.created_at, unread: !n.read_at, to: m.to, icon: m.icon, source: "personal", refId: n.id });
    }
    const read = notices.data?.read ?? new Set<string>();
    for (const n of notices.data?.notices ?? []) {
      const em = n.category === "emergency";
      out.push({ key: `n-${n.id}`, cat: "notices", title: n.title, body: `${noticeCategory(n.category).label} notice`, at: liveAt(n) ?? n.created_at,
        unread: !read.has(n.id), to: "/app/notices", icon: em ? Siren : Megaphone, emergency: em, source: "notice", refId: n.id });
    }
    for (const b of bills.data ?? []) {
      const at = b.finalized_at ?? b.created_at;
      out.push({ key: `b-${b.id}`, cat: "billing", title: b.status === "paid" ? "Bill paid" : "New maintenance bill",
        body: `${b.period_label ?? "Bill"}${b.due_date && b.status !== "paid" ? ` · due ${new Date(b.due_date).toLocaleDateString()}` : ""}`,
        at, unread: at > lastSeen, to: "/app/bills", icon: Receipt, source: "bill", refId: b.id });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [personal.data, notices.data, bills.data, lastSeen]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (cat === "all" || i.cat === cat) && (!s || `${i.title} ${i.body ?? ""}`.toLowerCase().includes(s)));
  }, [items, cat, q]);
  const unreadBy = (c: Cat) => items.filter((i) => i.unread && (c === "all" || i.cat === c)).length;

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    for (const i of shown) {
      const d = new Date(i.at);
      const k = d >= today ? "Today" : d >= yest ? "Yesterday" : d.toLocaleDateString();
      (g[k] ??= []).push(i);
    }
    return g;
  }, [shown]);

  async function markAllRead() {
    if (!user) return;
    await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    await Promise.all(items.filter((i) => i.source === "notice" && i.unread).map((i) => markNoticeRead(i.refId, user.id)));
    markNotificationsSeen();
    qc.invalidateQueries({ queryKey: ["user-notifications"] });
    qc.invalidateQueries({ queryKey: ["resident-notices"] });
  }

  function onOpen(i: Item) {
    if (!user || !i.unread) return;
    if (i.source === "personal") void supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("id", i.refId);
    if (i.source === "notice") void markNoticeRead(i.refId, user.id);
  }

  const loading = personal.isLoading && notices.isLoading;
  const partialError = personal.isError || notices.isError || bills.isError;
  const unreadShown = shown.filter((i) => i.unread);
  const readGrouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    for (const [k, list] of Object.entries(grouped)) {
      const r = list.filter((i) => !i.unread);
      if (r.length) g[k] = r;
    }
    return g;
  }, [grouped]);

  const row = (i: Item) => (
    <li key={i.key}>
      <Link to={i.to} onClick={() => onOpen(i)}
        className={cn("relative flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r",
          i.emergency ? "before:bg-destructive bg-destructive/5" : i.unread ? "before:bg-primary" : "before:bg-transparent")}>
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", i.emergency ? "bg-destructive text-destructive-foreground" : "bg-muted text-foreground")}>
          <i.icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{TABS.find((t) => t.v === i.cat)?.label} · {new Date(i.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
          <span className={cn("block truncate text-sm", i.unread ? "font-semibold" : "font-medium")}>{i.title}</span>
          {i.body && <span className="block truncate text-xs text-muted-foreground">{i.body}</span>}
        </span>
        {i.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
      </Link>
    </li>
  );

  return (
    <CommPage>
      <CommHeader
        title="Notifications"
        subtitle={unreadBy("all") > 0 ? `${unreadBy("all")} unread` : "Notices, bills, visitors, requests and parking"}
        action={unreadBy("all") > 0 ? <Button variant="outline" className="min-h-11 rounded-xl" onClick={markAllRead}>Mark all read</Button> : undefined}
      />

      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search notifications" className="h-11 rounded-xl pl-9" placeholder="Search notifications…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Notification type">
          {TABS.map((t) => {
            const n = unreadBy(t.v);
            return (
              <button key={t.v} role="tab" aria-selected={cat === t.v} onClick={() => setCat(t.v)}
                className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium",
                  cat === t.v ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground")}>
                {t.label}
                {n > 0 && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", cat === t.v ? "bg-background/20" : "bg-primary text-primary-foreground")}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {partialError && !loading && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-2xl bg-warning-container px-4 py-3 text-sm text-warning-container-foreground">
          <span>Some updates couldn't load, so this list may be incomplete.</span>
          <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => { void personal.refetch(); void notices.refetch(); void bills.refetch(); }}>Retry</Button>
        </div>
      )}

      {loading ? <ListSkeleton rows={5} />
        : shown.length === 0 ? (
          partialError ? null : (
            <ListEmpty icon={Inbox} title={q ? "No matches" : "You're all caught up"}>New notices and updates will show here.</ListEmpty>
          )
        ) : (
          <>
            {unreadShown.length > 0 && (<><SectionLabel count={unreadShown.length}>Needs your attention</SectionLabel><RowList>{unreadShown.map(row)}</RowList></>)}
            {Object.entries(readGrouped).map(([k, list]) => (
              <div key={k}><SectionLabel>{k}</SectionLabel><RowList>{list.map(row)}</RowList></div>
            ))}
          </>
        )}
    </CommPage>
  );
}
