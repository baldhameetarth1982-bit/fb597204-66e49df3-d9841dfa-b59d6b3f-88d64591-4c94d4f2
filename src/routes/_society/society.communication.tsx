import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone, FileText, Phone as PhoneIcon, MessageSquare, Vote,
  Sparkles, ArrowRight, BookOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/communication")({
  head: () => ({ meta: [{ title: "Communication Center — SociyoHub" }] }),
  component: CommunicationCenter,
});

function CommunicationCenter() {
  const { societyId } = useSocietyId();

  const { data: counts } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-counts", societyId],
    queryFn: async () => {
      const [notices, contacts] = await Promise.all([
        supabase.from("posts").select("id", { count: "exact", head: true }).eq("society_id", societyId!),
        supabase.from("society_contacts").select("id", { count: "exact", head: true }).eq("society_id", societyId!),
      ]);
      return { notices: notices.count ?? 0, contacts: contacts.count ?? 0 };
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
        .limit(6);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Society Admin"
        title="Communication"
        subtitle="Notices, documents, contacts, and community updates in one place."
        icon={MessageSquare}
        variant="teal"
        action={
          <Button asChild size="sm" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/society/announcements"><Megaphone className="h-4 w-4 mr-1.5" /> Notice</Link>
          </Button>
        }
        stats={
          <StatPillRow>
            <StatPill label="Notices" value={counts?.notices ?? "—"} icon={Megaphone} />
            <StatPill label="Contacts" value={counts?.contacts ?? "—"} icon={PhoneIcon} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <SectionCard title="Channels">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <ChannelTile to="/society/announcements" icon={Megaphone} label="Notices" count={counts?.notices} tone="ok" />
            <ChannelTile to="/society/bylaws" icon={FileText} label="Documents" tone="info" />
            <ChannelTile to="/society/contacts" icon={PhoneIcon} label="Contacts" count={counts?.contacts} tone="neutral" />
            <ChannelTile to="/society/polls" icon={Vote} label="Polls" tone="warn" />
          </div>
        </SectionCard>

        <SectionCard title="Admin actions">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/announcements"><Megaphone className="h-4 w-4" /><span className="text-xs">New Notice</span></Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/bylaws"><FileText className="h-4 w-4" /><span className="text-xs">Upload Doc</span></Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/contacts"><PhoneIcon className="h-4 w-4" /><span className="text-xs">Contacts</span></Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/digest"><Sparkles className="h-4 w-4" /><span className="text-xs">AI Digest</span></Link>
            </Button>
          </div>
        </SectionCard>

        {recent && recent.length > 0 && (
          <SectionCard
            title="Recent communications"
            action={
              <Button asChild variant="ghost" size="sm" className="rounded-xl">
                <Link to="/society/announcements">View all <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            <ListCardGroup>
              {recent.map((r: any) => (
                <ListCard
                  key={r.id}
                  leading={<span className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center"><BookOpen className="h-4 w-4" /></span>}
                  title={r.title ?? "Notice"}
                  subtitle={r.body || new Date(r.created_at).toLocaleDateString("en-IN")}
                />
              ))}
            </ListCardGroup>
          </SectionCard>
        )}
      </div>
    </div>
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
