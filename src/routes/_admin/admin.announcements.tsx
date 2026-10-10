import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/system/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/user-error";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_admin/admin/announcements")({
  head: () => ({ meta: [
    { title: "Announcements — Super Admin · SociyoHub" },
    { name: "description", content: "Send or schedule platform announcements to societies." },
    { property: "og:title", content: "Announcements — Super Admin · SociyoHub" },
    { property: "og:description", content: "Send or schedule platform announcements to societies." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AnnouncementsPage,
});

type Row = { id: string; title: string; body: string; audience: string; society_id: string | null; send_at: string; status: string; recipients: number | null };
const AUD = ["everyone", "society_admins", "residents", "guards"] as const;
const AUD_KEY: Record<string, string> = { everyone: "ln.ann.everyone", society_admins: "ln.ann.admins", residents: "ln.ann.residents", guards: "ln.ann.guards" };
const ALL = "__all__";

function localNowPlusHour() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function AnnouncementsPage() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string>("everyone");
  const [society, setSociety] = useState<string>(ALL);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState(localNowPlusHour());

  const list = useQuery({
    queryKey: ["platform-announcements"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("platform_announcements")
        .select("id,title,body,audience,society_id,send_at,status,recipients")
        .order("send_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const societies = useQuery({
    queryKey: ["ann-societies"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("societies").select("id,name").order("name").limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const send = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      let at: string | null = null;
      if (mode === "later") {
        const d = new Date(sendAt);
        const ms = d.getTime() - Date.now();
        if (!Number.isFinite(ms) || ms < 0 || ms > 90 * 86400_000) throw new Error("bad_time");
        at = d.toISOString();
      }
      const { error } = await (supabase.rpc as any)("admin_schedule_announcement", {
        _title: title.trim(), _body: body.trim(), _audience: audience,
        _society_id: society === ALL ? null : society, _send_at: at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tu(mode === "now" ? "ln.ann.doneNow" : "ln.ann.doneLater"));
      setTitle(""); setBody("");
      qc.invalidateQueries({ queryKey: ["platform-announcements"] });
    },
    onError: (e: Error) => toast.error(e.message === "bad_time" || e.message.includes("invalid_send_time") ? tu("ln.ann.badTime") : userMessage(e)),
  });
  const cancel = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("admin_cancel_announcement", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-announcements"] }),
    onError: (e: Error) => toast.error(userMessage(e)),
  });

  const valid = title.trim().length >= 3 && body.trim().length >= 1;
  const nameOf = (id: string | null) => (id ? societies.data?.find((s) => s.id === id)?.name ?? "—" : tu("ln.ann.allSocieties"));

  return (
    <PageShell>
      <PageHeader title={tu("ln.ann.nav")} description={tu("ln.ann.desc")} />
      <div className="mx-auto grid max-w-3xl gap-5">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <Label htmlFor="ann-title">{tu("ln.ann.title")}</Label>
              <Input id="ann-title" className="mt-1" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ann-body">{tu("ln.ann.body")}</Label>
              <Textarea id="ann-body" className="mt-1" maxLength={300} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{tu("ln.ann.audience")}</Label>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{AUD.map((a) => <SelectItem key={a} value={a}>{tu(AUD_KEY[a])}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tu("ln.ann.society")}</Label>
                <Select value={society} onValueChange={setSociety}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{tu("ln.ann.allSocieties")}</SelectItem>
                    {(societies.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "now" | "later")}>
              <TabsList>
                <TabsTrigger value="now">{tu("ln.ann.now")}</TabsTrigger>
                <TabsTrigger value="later">{tu("ln.ann.later")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === "later" && (
              <div>
                <Label htmlFor="ann-at">{tu("ln.ann.sendAt")}</Label>
                <Input id="ann-at" type="datetime-local" className="mt-1 max-w-xs" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">{tu("ln.ann.hourNote")}</p>
              </div>
            )}
            <Button disabled={!valid || send.isPending} onClick={() => send.mutate()} className="min-h-11">
              {send.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {tu(mode === "now" ? "ln.ann.now" : "ln.ann.later")}
            </Button>
          </CardContent>
        </Card>

        {list.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : list.isError ? (
          <ErrorState onRetry={() => list.refetch()} showSupport={false} />
        ) : !list.data?.length ? (
          <p className="text-center text-sm text-muted-foreground">{tu("ln.ann.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {list.data.map((a) => (
              <li key={a.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{a.title}</p>
                      <p className="text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tu(AUD_KEY[a.audience] ?? "ln.ann.everyone")} · {nameOf(a.society_id)} · {new Date(a.send_at).toLocaleString()}
                        {a.status === "sent" && a.recipients !== null ? ` · ${tu("ln.ann.recipients")}: ${a.recipients}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.status === "sent" ? "default" : "secondary"}>{tu(`ln.ann.${a.status}`)}</Badge>
                      {a.status === "scheduled" && (
                        <Button size="sm" variant="outline" className="min-h-11" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                          {tu("ln.ann.cancel")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
