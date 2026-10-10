import { LoadError } from "@/components/people/PeopleUI";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone, LifeBuoy, FileText, Phone, Search, ArrowRight, Inbox,
  Users, Car, Wrench, Home, History, ShieldCheck, Trophy, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { localeTag } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_resident/app/comm")({
  head: () => ({
    meta: [
      { title: "Society — SociyoHub" },
      { name: "description", content: "Notices, complaints, documents & contacts in one place." },
    ],
  }),
  component: CommunicationCenter,
});

function CommunicationCenter() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const societyId = profile?.society_id;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("notices");

  const { data: notices = [], isError: noticesErr, refetch: refetchNotices } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-notices", societyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, body, created_at")
        .eq("society_id", societyId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: complaints = [], isError: complaintsErr, refetch: refetchComplaints } = useQuery({
    enabled: !!societyId && !!profile?.id,
    queryKey: ["comm-complaints", societyId, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, subject, status, priority, created_at, category")
        .eq("society_id", societyId!)
        .eq("user_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: contacts = [], isError: contactsErr, refetch: refetchContacts } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-contacts", societyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("society_contacts")
        .select("id, name, role_label, category, phone")
        .eq("society_id", societyId!)
        .order("category")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filteredNotices = useMemo(() => {
    if (!q) return notices;
    const s = q.toLowerCase();
    return notices.filter((n: any) => (n.body ?? "").toLowerCase().includes(s));
  }, [notices, q]);

  const filteredContacts = useMemo(() => {
    if (!q) return contacts;
    const s = q.toLowerCase();
    return contacts.filter((c: any) =>
      (c.name ?? "").toLowerCase().includes(s) ||
      (c.role_label ?? "").toLowerCase().includes(s) ||
      (c.category ?? "").toLowerCase().includes(s),
    );
  }, [contacts, q]);

  const filteredComplaints = useMemo(() => {
    if (!q) return complaints;
    const s = q.toLowerCase();
    return complaints.filter((c: any) => (c.subject ?? "").toLowerCase().includes(s));
  }, [complaints, q]);

  const contactsByCategory = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const c of filteredContacts) {
      const k = (c as any).category || t("vch.kind.other");
      (map[k] ??= []).push(c);
    }
    return map;
  }, [filteredContacts, t]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{t("nav.society")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("comm.subtitle")}
        </p>
      </header>

      {/* P04: household & activity features moved here from Profile (routes unchanged). */}
      <nav aria-label={t("prof.g.household")} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          ["/app/family", Users, t("prof.family")],
          ["/app/vehicles", Car, t("nav.vehicles")],
          ["/app/services", Wrench, t("prof.services")],
          ["/app/household-history", Home, t("prof.homeHistory")],
          ["/app/activity", History, t("prof.g.activity")],
          ["/app/trust", ShieldCheck, t("prof.trust")],
          ["/app/achievements", Trophy, t("prof.points")],
          ["/app/partner", Wallet, t("prof.g.partner")],
        ] as const).map(([to, Icon, label]) => (
          <Link key={to} to={to}
            className="flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>


      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl h-11"
          placeholder={t("comm.searchPh")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full rounded-xl h-11">
          <TabsTrigger value="notices" className="rounded-lg">
            <Megaphone className="h-4 w-4 mr-1.5" /> {t("notif.tab.notices")}
          </TabsTrigger>
          <TabsTrigger value="complaints" className="rounded-lg">
            <LifeBuoy className="h-4 w-4 mr-1.5" /> {t("home.qa.complaints")}
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg">
            <FileText className="h-4 w-4 mr-1.5" /> {t("comm.docs")}
          </TabsTrigger>
          <TabsTrigger value="contacts" className="rounded-lg">
            <Phone className="h-4 w-4 mr-1.5" /> {t("comm.contacts")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notices" className="mt-4 space-y-2">
          {noticesErr ? (
            <LoadError title={t("comm.noticesErr")} onRetry={() => refetchNotices()} />
          ) : filteredNotices.length === 0 ? (
            <EmptyBlock icon={Inbox} title={t("home.noNotices")}
              description={t("comm.noticesEmptyDesc")} />
          ) : (
            filteredNotices.map((n: any) => (
              <Card key={n.id} className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm whitespace-pre-line">{(n.body ?? "").slice(0, 240)}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString(localeTag())}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
          <Button asChild variant="ghost" size="sm" className="w-full rounded-lg mt-2">
            <Link to="/app/notices">{t("comm.openBoard")} <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
        </TabsContent>

        <TabsContent value="complaints" className="mt-4 space-y-2">
          {complaintsErr ? (
            <LoadError title={t("comm.complaintsErr")} onRetry={() => refetchComplaints()} />
          ) : filteredComplaints.length === 0 ? (
            <EmptyBlock icon={LifeBuoy} title={t("comm.complaintsEmpty")}
              description={t("comm.complaintsEmptyDesc")}
              action={<Button asChild size="sm" className="rounded-xl"><Link to="/app/helpdesk">{t("comm.raise")}</Link></Button>} />
          ) : (
            <>
              {filteredComplaints.map((c: any) => (
                <Card key={c.id} className="rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <p className="flex-1 min-w-0 truncate font-medium text-sm">{c.subject}</p>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {c.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {c.category ?? t("comm.general")} · {new Date(c.created_at).toLocaleDateString(localeTag())}
                    </p>
                  </CardContent>
                </Card>
              ))}
              <Button asChild variant="ghost" size="sm" className="w-full rounded-lg mt-2">
                <Link to="/app/helpdesk">{t("comm.manage")} <ArrowRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card className="rounded-2xl">
            <CardContent className="p-5 text-center">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground opacity-60" />
              <p className="mt-2 font-medium">{t("comm.docsTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("comm.docsDesc")}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button asChild size="sm" className="rounded-xl min-h-11">
                  <Link to="/app/bylaws">{t("comm.openDocs")}</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11">
                  <Link to="/app/secretary">{t("home.askAi")}</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/documents">{t("section.knowledge")}</Link></Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/meetings">{t("mod.meetings")}</Link></Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/votes">{t("mod.votes")}</Link></Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/elections">{t("mod.elections")}</Link></Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/agm">{t("mod.agm")}</Link></Button>
                <Button asChild size="sm" variant="outline" className="rounded-xl min-h-11"><Link to="/app/privacy-requests">{t("comm.myPrivacy")}</Link></Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="mt-4 space-y-3">
          {contactsErr ? (
            <LoadError title={t("comm.contactsErr")} onRetry={() => refetchContacts()} />
          ) : Object.keys(contactsByCategory).length === 0 ? (
            <EmptyBlock icon={Phone} title={t("comm.contactsEmpty")}
              description={t("comm.contactsEmptyDesc")} />
          ) : (
            Object.entries(contactsByCategory).map(([cat, list]) => (
              <div key={cat}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1.5">
                  {cat}
                </p>
                <div className="space-y-2">
                  {list.map((c: any) => (
                    <Card key={c.id} className="rounded-2xl">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center shrink-0">
                          <Phone className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{c.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{c.role_label ?? cat}</p>
                        </div>
                        {c.phone && (
                          <Button asChild size="sm" variant="outline" className="rounded-xl">
                            <a href={`tel:${c.phone}`}>{t("comm.call")}</a>
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyBlock({
  icon: Icon, title, description, action,
}: { icon: any; title: string; description: string; action?: React.ReactNode }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-8 text-center">
        <Icon className="h-8 w-8 mx-auto text-muted-foreground opacity-60" />
        <p className="mt-2 font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
        {action && <div className="mt-3">{action}</div>}
      </CardContent>
    </Card>
  );
}
