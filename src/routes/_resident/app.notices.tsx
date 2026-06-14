import { createFileRoute } from "@tanstack/react-router";
import { Bell, Megaphone, Paperclip, Pin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

export const Route = createFileRoute("/_resident/app/notices")({
  head: () => ({ meta: [{ title: "Notices — SocioHub" }] }),
  component: NoticesPage,
});

type Notice = {
  id: string;
  title: string;
  body: string;
  category: "General" | "Maintenance" | "Event" | "Urgent";
  date: string;
  pinned?: boolean;
  attachments?: number;
};

const SAMPLE: Notice[] = [
  {
    id: "1",
    title: "Diwali celebration — Saturday 7 PM",
    body: "Join us at the clubhouse for sweets, music and rangoli. Families welcome.",
    category: "Event",
    date: "Today",
    pinned: true,
    attachments: 1,
  },
  {
    id: "2",
    title: "Water tank cleaning — Block A",
    body: "Supply will be off from 10 AM to 2 PM on Friday. Please store water in advance.",
    category: "Maintenance",
    date: "Yesterday",
  },
  {
    id: "3",
    title: "Lift AMC renewal completed",
    body: "Annual maintenance contract for all 6 elevators has been renewed with OTIS.",
    category: "General",
    date: "2 days ago",
    attachments: 2,
  },
  {
    id: "4",
    title: "Visitor entry policy update",
    body: "All visitors must now be pre-approved via the app. See attached SOP.",
    category: "Urgent",
    date: "1 week ago",
    attachments: 1,
  },
];

const CAT_COLORS: Record<Notice["category"], string> = {
  General: "bg-blue-100 text-blue-700",
  Maintenance: "bg-amber-100 text-amber-700",
  Event: "bg-emerald-100 text-emerald-700",
  Urgent: "bg-rose-100 text-rose-700",
};

function NoticesPage() {
  const [q, setQ] = useState("");
  const filtered = SAMPLE.filter(
    (n) =>
      n.title.toLowerCase().includes(q.toLowerCase()) ||
      n.body.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
          <Megaphone className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Notices</h1>
          <p className="text-xs text-muted-foreground">
            Announcements from your society admin
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notices..."
          className="pl-9 rounded-xl h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Bell className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">No notices found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => (
            <Card key={n.id} className="rounded-2xl border-border">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {n.pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
                    <Badge
                      variant="secondary"
                      className={`${CAT_COLORS[n.category]} rounded-full px-2 py-0.5 text-[10px] font-medium border-0`}
                    >
                      {n.category}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{n.date}</span>
                </div>
                <h3 className="font-semibold text-sm leading-snug">{n.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{n.body}</p>
                {n.attachments && (
                  <div className="flex items-center gap-1 pt-1 text-[11px] text-primary">
                    <Paperclip className="h-3 w-3" />
                    {n.attachments} attachment{n.attachments > 1 ? "s" : ""}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
