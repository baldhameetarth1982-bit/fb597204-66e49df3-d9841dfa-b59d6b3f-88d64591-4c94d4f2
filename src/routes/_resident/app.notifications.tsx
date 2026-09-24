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

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2"><Bell className="h-6 w-6 text-primary" /> Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Notices, bills, visitors, requests and parking.</p>
        </div>
        {unreadBy("all") > 0 && <Button variant="ghost" className="min-h-11" onClick={markAllRead}>Mark all read</Button>}
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search notifications" className="pl-9 rounded-xl h-11" placeholder="Search notifications…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => {
          const n = unreadBy(t.v);
          return (
            <button key={t.v} role="tab" aria-selected={cat === t.v} onClick={() => setCat(t.v)}
              className={cn("min-h-11 px-4 rounded-full border text-sm whitespace-nowrap", cat === t.v ? "bg-primary text-primary-foreground border-primary" : "border-border")}>
              {t.label}{n > 0 ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>

      {partialError && !loading && (
        <div className="rounded-xl bg-muted p-3 text-sm flex items-center justify-between gap-2">
          <span>Some updates couldn't load.</span>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => { void personal.refetch(); void notices.refetch(); void bills.refetch(); }}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground opacity-60" />
          <p className="mt-2 font-semibold">{q ? "No matches" : "You're all caught up"}</p>
          <p className="text-xs text-muted-foreground mt-1">New notices and updates will show here.</p>
        </CardContent></Card>
      ) : (
        Object.entries(grouped).map(([k, list]) => (
          <div key={k}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1.5">{k}</p>
            <div className="space-y-2">
              {list.map((i) => (
                <Link key={i.key} to={i.to} onClick={() => onOpen(i)} className="block">
                  <Card className={cn("rounded-2xl hover:bg-accent/40 transition-colors", i.unread && "border-primary/40", i.emergency && "border-destructive bg-destructive/5")}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-full grid place-items-center shrink-0", i.emergency ? "bg-destructive text-destructive-foreground" : "bg-primary/10 text-primary")}>
                        <i.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{i.title}</p>
                        {i.body && <p className="text-xs text-muted-foreground truncate">{i.body}</p>}
                        <p className="text-[11px] text-muted-foreground">{new Date(i.at).toLocaleString()}</p>
                      </div>
                      {i.unread && <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
