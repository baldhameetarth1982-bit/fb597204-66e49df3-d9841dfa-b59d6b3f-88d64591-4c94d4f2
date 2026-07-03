import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Megaphone, LifeBuoy, FileText, Phone, Search, ArrowRight, Inbox, Pin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_resident/app/comm")({
  head: () => ({
    meta: [
      { title: "Society — SocioHub" },
      { name: "description", content: "Notices, complaints, documents & contacts in one place." },
    ],
  }),
  component: CommunicationCenter,
});

function CommunicationCenter() {
  const { profile } = useAuth();
  const societyId = profile?.society_id;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("notices");

  const { data: notices = [] } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-notices", societyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, body, created_at, is_pinned")
        .eq("society_id", societyId!)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: complaints = [] } = useQuery({
    enabled: !!societyId && !!profile?.id,
    queryKey: ["comm-complaints", societyId, profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("id, subject, status, priority, created_at, category")
        .eq("society_id", societyId!)
        .eq("user_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: contacts = [] } = useQuery({
    enabled: !!societyId,
    queryKey: ["comm-contacts", societyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("society_contacts")
        .select("id, name, role, category, phone, email")
        .eq("society_id", societyId!)
        .order("category")
        .limit(200);
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
      (c.role ?? "").toLowerCase().includes(s) ||
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
      const k = (c as any).category || "Other";
      (map[k] ??= []).push(c);
    }
    return map;
  }, [filteredContacts]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Society</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Notices, complaints, documents and contacts — all in one place.
        </p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl h-11"
          placeholder="Search notices, complaints, contacts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full rounded-xl h-11">
          <TabsTrigger value="notices" className="rounded-lg">
            <Megaphone className="h-4 w-4 mr-1.5" /> Notices
          </TabsTrigger>
          <TabsTrigger value="complaints" className="rounded-lg">
            <LifeBuoy className="h-4 w-4 mr-1.5" /> Complaints
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg">
            <FileText className="h-4 w-4 mr-1.5" /> Docs
          </TabsTrigger>
          <TabsTrigger value="contacts" className="rounded-lg">
            <Phone className="h-4 w-4 mr-1.5" /> Contacts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notices" className="mt-4 space-y-2">
          {filteredNotices.length === 0 ? (
            <EmptyBlock icon={Inbox} title="No notices yet"
              description="Society announcements will show up here." />
          ) : (
            filteredNotices.map((n: any) => (
              <Card key={n.id} className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    {n.is_pinned && <Pin className="h-4 w-4 shrink-0 text-primary mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm whitespace-pre-line">{(n.body ?? "").slice(0, 240)}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
          <Button asChild variant="ghost" size="sm" className="w-full rounded-lg mt-2">
            <Link to="/app/notices">Open full notice board <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
        </TabsContent>

        <TabsContent value="complaints" className="mt-4 space-y-2">
          {filteredComplaints.length === 0 ? (
            <EmptyBlock icon={LifeBuoy} title="No complaints filed"
              description="Raise a helpdesk ticket if something needs the committee's attention."
              action={<Button asChild size="sm" className="rounded-xl"><Link to="/app/helpdesk">Raise a complaint</Link></Button>} />
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
                      {c.category ?? "General"} · {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
              <Button asChild variant="ghost" size="sm" className="w-full rounded-lg mt-2">
                <Link to="/app/helpdesk">Manage complaints <ArrowRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card className="rounded-2xl">
            <CardContent className="p-5 text-center">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground opacity-60" />
              <p className="mt-2 font-medium">Society documents</p>
              <p className="text-xs text-muted-foreground">By-laws, forms, minutes, certificates.</p>
              <Button asChild size="sm" className="mt-3 rounded-xl">
                <Link to="/app/bylaws">Open document centre</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="mt-4 space-y-3">
          {Object.keys(contactsByCategory).length === 0 ? (
            <EmptyBlock icon={Phone} title="No contacts published"
              description="Committee, security, and utility contacts will appear here." />
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
                          <p className="text-[11px] text-muted-foreground truncate">{c.role ?? cat}</p>
                        </div>
                        {c.phone && (
                          <Button asChild size="sm" variant="outline" className="rounded-xl">
                            <a href={`tel:${c.phone}`}>Call</a>
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
