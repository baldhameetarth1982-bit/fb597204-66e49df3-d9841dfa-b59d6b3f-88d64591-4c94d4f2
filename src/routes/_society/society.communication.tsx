import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone, FileText, Phone as PhoneIcon, MessageSquare, Vote,
  Sparkles, ArrowRight, BookOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/communication")({
  head: () => ({ meta: [{ title: "Communication Center — SocioHub" }] }),
  component: CommunicationCenter,
});

function CommunicationCenter() {
  const { societyId } = useSocietyId();

  const { data: counts } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-counts", societyId],
    queryFn: async () => {
      const [notices, contacts] = await Promise.all([
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("society_id", societyId!),
        supabase
          .from("society_contacts")
          .select("id", { count: "exact", head: true })
          .eq("society_id", societyId!),
      ]);
      return {
        notices: notices.count ?? 0,
        contacts: contacts.count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  const { data: recent } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-recent", societyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, title, body, created_at, kind")
        .eq("society_id", societyId!)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <PageShell>
      <PageHeader
        title="Communication"
        description="Notices, documents, contacts, and community updates in one place."
      />

      {/* Hero */}
      <Card className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/15 grid place-items-center shrink-0">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Keep your community informed</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Post announcements, share documents, and manage contacts.
            </p>
          </div>
          <Button asChild size="sm" className="rounded-xl shrink-0">
            <Link to="/society/announcements">
              New Notice <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Channels */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <ChannelTile
          to="/society/announcements"
          icon={Megaphone}
          label="Notices"
          count={counts?.notices}
          tone="ok"
        />
        <ChannelTile
          to="/society/bylaws"
          icon={FileText}
          label="Documents"
          tone="info"
        />
        <ChannelTile
          to="/society/contacts"
          icon={PhoneIcon}
          label="Contacts"
          count={counts?.contacts}
          tone="neutral"
        />
        <ChannelTile
          to="/society/polls"
          icon={Vote}
          label="Polls"
          tone="warn"
        />
      </div>

      {/* Admin actions */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Admin actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/announcements">
                <Megaphone className="h-4 w-4" />
                <span className="text-xs">Create Notice</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/bylaws">
                <FileText className="h-4 w-4" />
                <span className="text-xs">Upload Document</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/contacts">
                <PhoneIcon className="h-4 w-4" />
                <span className="text-xs">Manage Contacts</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/digest">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs">AI Digest</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent */}
      {recent && recent.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Recent communications</h3>
              <Button asChild variant="ghost" size="sm" className="rounded-xl">
                <Link to="/society/announcements">View all</Link>
              </Button>
            </div>
            <ul className="divide-y">
              {recent.map((r: any) => (
                <li key={r.id} className="py-2.5 flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-xl bg-primary/10 grid place-items-center shrink-0 mt-0.5">
                    <BookOpen className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.title ?? "Notice"}</p>
                    {r.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{r.body}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(r.created_at).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function ChannelTile({
  to, icon: Icon, label, count, tone,
}: {
  to: string; icon: any; label: string; count?: number;
  tone: "ok" | "warn" | "info" | "neutral";
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 bg-emerald-500/10"
    : tone === "warn" ? "text-amber-600 bg-amber-500/10"
    : tone === "info" ? "text-violet-600 bg-violet-500/10"
    : "text-muted-foreground bg-muted";
  return (
    <Link
      to={to as any}
      className="rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 transition p-3 flex flex-col gap-2 min-h-[92px]"
    >
      <div className={cn("h-9 w-9 rounded-xl grid place-items-center", toneCls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {typeof count === "number" && (
          <div className="text-[10px] text-muted-foreground">{count} total</div>
        )}
      </div>
    </Link>
  );
}
