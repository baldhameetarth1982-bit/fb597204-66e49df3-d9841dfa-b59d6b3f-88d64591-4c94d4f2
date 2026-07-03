import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Receipt, ShieldCheck, LifeBuoy, Megaphone, FileText, Inbox, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_resident/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — SocioHub" },
      { name: "description", content: "All your society activity in one feed." },
    ],
  }),
  component: NotificationCenter,
});

type Notif = {
  id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  created_at: string;
  metadata: any;
};

const ACTION_META: Record<string, { icon: any; label: string; link?: (n: Notif) => string }> = {
  payment_captured: { icon: Receipt, label: "Payment received", link: () => "/app/bills" },
  payment_failed: { icon: Receipt, label: "Payment failed", link: () => "/app/bills" },
  bill_generated: { icon: Receipt, label: "New bill generated", link: () => "/app/bills" },
  maintenance_reminder_sent: { icon: Receipt, label: "Maintenance reminder", link: () => "/app/dues" },
  visitor_entered: { icon: ShieldCheck, label: "Visitor entered", link: () => "/app/visitors" },
  visitor_exited: { icon: ShieldCheck, label: "Visitor exited", link: () => "/app/visitors" },
  notice_published: { icon: Megaphone, label: "New notice", link: () => "/app/comm" },
  complaint_updated: { icon: LifeBuoy, label: "Complaint updated", link: () => "/app/helpdesk" },
  document_uploaded: { icon: FileText, label: "Document uploaded", link: () => "/app/bylaws" },
};

function iconFor(action: string) {
  return ACTION_META[action]?.icon ?? Bell;
}
function labelFor(action: string) {
  return ACTION_META[action]?.label ?? action.replace(/_/g, " ");
}
function linkFor(n: Notif) {
  return ACTION_META[n.action]?.link?.(n) ?? "/app/dashboard";
}

function NotificationCenter() {
  const { profile } = useAuth();
  const societyId = profile?.society_id;
  const [q, setQ] = useState("");

  const { data = [], isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["notifications", societyId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id, action, target_table, target_id, created_at, metadata")
        .eq("society_id", societyId!)
        .in("action", Object.keys(ACTION_META))
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as Notif[];
    },
  });

  const filtered = useMemo(() => {
    if (!q) return data;
    const s = q.toLowerCase();
    return data.filter((n) => labelFor(n.action).toLowerCase().includes(s) ||
      JSON.stringify(n.metadata ?? {}).toLowerCase().includes(s));
  }, [data, q]);

  const grouped = useMemo(() => {
    const groups: Record<string, Notif[]> = {};
    for (const n of filtered) {
      const d = new Date(n.created_at);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const key = d >= today ? "Today" : d >= yesterday ? "Yesterday" : d.toLocaleDateString();
      (groups[key] ??= []).push(n);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" /> Notifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Society activity in one feed.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl h-11"
          placeholder="Search notifications…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-10 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground opacity-60" />
            <p className="mt-2 font-semibold">You're all caught up</p>
            <p className="text-xs text-muted-foreground mt-1">
              New activity from your society will land here.
            </p>
            <Button asChild size="sm" className="mt-3 rounded-xl">
              <Link to="/app/dashboard">Back to home</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([k, items]) => (
          <div key={k}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1.5">{k}</p>
            <div className="space-y-2">
              {items.map((n) => {
                const Icon = iconFor(n.action);
                const to = linkFor(n);
                const amt = n.metadata?.amount;
                return (
                  <Link key={n.id} to={to} className="block">
                    <Card className="rounded-2xl hover:bg-accent/40 transition-colors">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{labelFor(n.action)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(n.created_at).toLocaleString()}
                            {amt ? ` · ₹${amt}` : ""}
                          </p>
                        </div>
                        <Badge variant="outline" className="rounded-full text-[10px] shrink-0">
                          {n.target_table ?? "event"}
                        </Badge>
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
