import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ShieldCheck, LifeBuoy, ParkingSquare, Inbox, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { markNotificationsSeen } from "@/hooks/useUnreadNotifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_resident/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — SociyoHub" },
      { name: "description", content: "Your visitor, request and parking updates in one place." },
    ],
  }),
  component: NotificationCenter,
});

type Notif = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

const ICONS: Record<string, typeof Bell> = {
  visitor_approval: ShieldCheck, visitor_entered: ShieldCheck, visitor_exited: ShieldCheck,
  helpdesk: LifeBuoy, parking: ParkingSquare,
};
const SAFE_LINKS = new Set(["/app/visitors", "/app/helpdesk", "/app/vehicles"]);

function NotificationCenter() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const key = ["user-notifications", user?.id];

  const list = useQuery({
    enabled: !!user,
    queryKey: key,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("id, kind, title, body, link, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Notif[];
    },
  });

  useEffect(() => { markNotificationsSeen(); }, []);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-notifs-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["user-notifications"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const data = list.data ?? [];
  const unread = data.filter((n) => !n.read_at).length;

  async function markAllRead() {
    await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["user-notifications"] });
  }

  const grouped = useMemo(() => {
    const s = q.toLowerCase();
    const groups: Record<string, Notif[]> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    for (const n of data) {
      if (s && !`${n.title} ${n.body ?? ""}`.toLowerCase().includes(s)) continue;
      const d = new Date(n.created_at);
      const k = d >= today ? "Today" : d >= yesterday ? "Yesterday" : d.toLocaleDateString();
      (groups[k] ??= []).push(n);
    }
    return groups;
  }, [data, q]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Visitors, requests and parking updates.</p>
        </div>
        {unread > 0 && <Button variant="ghost" className="min-h-11" onClick={markAllRead}>Mark all read</Button>}
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search notifications" className="pl-9 rounded-xl h-11" placeholder="Search notifications…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : list.isError ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">We couldn't load your notifications.</p>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => list.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : Object.keys(grouped).length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground opacity-60" />
          <p className="mt-2 font-semibold">{q ? "No matches" : "You're all caught up"}</p>
          <p className="text-xs text-muted-foreground mt-1">Visitor alerts and request updates will show here.</p>
        </CardContent></Card>
      ) : (
        Object.entries(grouped).map(([k, items]) => (
          <div key={k}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1.5">{k}</p>
            <div className="space-y-2">
              {items.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                const to = n.link && SAFE_LINKS.has(n.link) ? n.link : "/app/dashboard";
                return (
                  <Link key={n.id} to={to} className="block">
                    <Card className={cn("rounded-2xl hover:bg-accent/40 transition-colors", !n.read_at && "border-primary/40")}>
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{n.title}</p>
                          {n.body && <p className="text-xs text-muted-foreground truncate">{n.body}</p>}
                          <p className="text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                        </div>
                        {!n.read_at && <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
