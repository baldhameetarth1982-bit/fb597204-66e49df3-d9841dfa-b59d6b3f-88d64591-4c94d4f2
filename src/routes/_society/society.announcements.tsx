import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Megaphone, Plus, Archive, Clock, Eye, Siren, Users } from "lucide-react";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";
import { NOTICE_CATEGORIES, commErrorMessage, liveAt, noticeCategory, type NoticeRow } from "@/lib/notices";

export const Route = createFileRoute("/_society/society/announcements")({
  head: () => ({
    meta: [
      { title: "Notices & Announcements — SociyoHub" },
      { name: "description", content: "Write, schedule and publish official notices to residents." },
      { property: "og:title", content: "Notices & Announcements — SociyoHub" },
      { property: "og:description", content: "Write, schedule and publish official notices to residents." },
    ],
  }),
  component: NoticesAdmin,
});

type Tab = "published" | "scheduled" | "draft" | "archived";
const FLOW: { key: Tab; label: string; hint: string }[] = [
  { key: "draft", label: "Drafts", hint: "Saved but not visible to residents. Continue editing to publish or schedule." },
  { key: "scheduled", label: "Scheduled", hint: "Will go live automatically at the time shown." },
  { key: "published", label: "Published", hint: "Live for residents. Editing is allowed for 7 days after publishing." },
  { key: "archived", label: "Archived", hint: "Removed from residents' view; kept for your records." },
];
const EMPTY = { id: null as string | null, title: "", body: "", category: "general", audience: "all", block_id: "", schedule: "" };

function NoticesAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("published");
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);

  const q = useQuery({
    queryKey: ["admin-notices", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const [n, b, r] = await Promise.all([
        supabase.from("notices").select("id, title, body, category, audience, block_id, status, publish_at, published_at, created_at, edited_at")
          .eq("society_id", societyId!).order("created_at", { ascending: false }).limit(200),
        supabase.from("blocks").select("id, name").eq("society_id", societyId!).order("name"),
        supabase.rpc("notice_read_counts"),
      ]);
      if (n.error) throw n.error;
      return {
        notices: (n.data ?? []) as NoticeRow[],
        blocks: (b.data ?? []) as { id: string; name: string }[],
        reads: new Map(((r.data ?? []) as { notice_id: string; reads: number }[]).map((x) => [x.notice_id, Number(x.reads)])),
      };
    },
  });

  const now = Date.now();
  const bucket = (n: NoticeRow): Tab =>
    n.status === "archived" ? "archived" : n.status === "draft" ? "draft" : new Date(liveAt(n) ?? n.created_at).getTime() > now ? "scheduled" : "published";
  const all = q.data?.notices ?? [];
  const rows = all.filter((n) => bucket(n) === tab);
  const count = (t: Tab) => all.filter((n) => bucket(n) === t).length;
  const blockName = (id: string | null) => q.data?.blocks.find((b) => b.id === id)?.name;

  function edit(n: NoticeRow) {
    const sched = n.publish_at && new Date(n.publish_at).getTime() > now ? n.publish_at.slice(0, 16) : "";
    setForm({ id: n.id, title: n.title, body: n.body, category: n.category, audience: n.audience, block_id: n.block_id ?? "", schedule: sched });
    setOpen(true);
  }

  async function save(publish: boolean) {
    if (saving) return;
    if (publish && form.category === "emergency" && !confirm("Publish this emergency notice to residents now?")) return;
    setSaving(publish ? "publish" : "draft");
    const { error } = await supabase.rpc("notice_save", {
      _id: form.id as string, _title: form.title, _body: form.body, _category: form.category, _audience: form.audience,
      _block_id: (form.audience === "block" ? form.block_id || null : null) as string, _publish: publish,
      _publish_at: (form.schedule ? new Date(form.schedule).toISOString() : null) as string,
    });
    setSaving(null);
    if (error) return toast.error(commErrorMessage(error)); // form kept for retry
    toast.success(!publish ? "Draft saved" : form.schedule ? "Notice scheduled" : "Notice published — residents will see it in Notices and Notifications");
    setOpen(false);
    setForm(EMPTY);
    qc.invalidateQueries({ queryKey: ["admin-notices"] });
  }

  async function archive(id: string) {
    if (!confirm("Archive this notice? Residents will no longer see it.")) return;
    const { error } = await supabase.rpc("notice_archive", { _id: id });
    if (error) return toast.error(commErrorMessage(error));
    toast.success("Notice archived");
    qc.invalidateQueries({ queryKey: ["admin-notices"] });
  }

  const isLive = form.id && all.find((n) => n.id === form.id)?.status === "published";

  return (
    <PageShell>
      <PageHeader
        title="Notices"
        description="Official announcements for residents"
        actions={<Button className="rounded-xl min-h-11" onClick={() => { setForm(EMPTY); setOpen(true); }}><Plus className="h-4 w-4 mr-2" />New notice</Button>}
      />
      <nav aria-label="Notice workflow" className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1">
        {FLOW.map((f, i) => (
          <button key={f.key} role="tab" aria-selected={tab === f.key} onClick={() => setTab(f.key)}
            className={cn("flex min-h-14 shrink-0 items-center gap-2 rounded-xl border px-3 text-left text-sm transition-colors",
              tab === f.key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-semibold", tab === f.key ? "bg-background/20" : "bg-muted")}>{i + 1}</span>
            <span><span className="block font-medium">{f.label}</span><span className="block text-xs tabular-nums opacity-80">{q.data ? count(f.key) : "—"}</span></span>
          </button>
        ))}
      </nav>
      <p className="mb-4 px-1 text-xs text-muted-foreground">{FLOW.find((f) => f.key === tab)!.hint}</p>

      {q.isLoading ? <ListSkeleton rows={4} />
        : q.isError ? <LoadError title="We couldn't load notices." onRetry={() => q.refetch()} />
        : rows.length === 0 ? (
          <ListEmpty icon={Megaphone} title={tab === "published" ? "Nothing published yet" : "Nothing here"}>
            {tab === "published" ? "Publish your first notice to reach residents." : "No notices in this stage."}
          </ListEmpty>
        ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((n) => {
            const c = noticeCategory(n.category);
            const em = n.category === "emergency";
            const editable = n.status !== "archived" && (n.status === "draft" || now - new Date(liveAt(n) ?? n.created_at).getTime() < 7 * 864e5);
            return (
              <li key={n.id} className={cn("relative grid gap-2 px-4 py-3 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r md:grid-cols-[1fr_13rem_auto] md:items-center md:gap-4",
                em ? "before:bg-destructive bg-destructive/5" : tab === "scheduled" ? "before:bg-info" : tab === "draft" ? "before:bg-warning" : "before:bg-transparent")}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {em && <Siren className="h-3.5 w-3.5 text-destructive" aria-hidden />}
                    <span className={cn("rounded px-1.5 py-0.5 font-medium", c.className)}>{c.label}</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{n.audience === "block" ? `Block ${blockName(n.block_id) ?? ""}` : "All residents"}</span>
                    {n.edited_at && <span>· edited</span>}
                  </p>
                  <p className="mt-0.5 truncate font-medium">{n.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{n.body}</p>
                </div>
                <div className="text-xs text-muted-foreground md:text-sm">
                  {tab === "scheduled" && <p className="flex items-center gap-1 font-medium text-foreground"><Clock className="h-3.5 w-3.5" />Goes live {new Date(liveAt(n)!).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>}
                  {tab === "published" && <><p>Published {new Date(liveAt(n) ?? n.created_at).toLocaleDateString()}</p><p className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{q.data?.reads.has(n.id) ? `${q.data.reads.get(n.id)} read` : "Reads unavailable"}</p></>}
                  {tab === "draft" && <p>Not visible to residents</p>}
                  {tab === "archived" && <p>Hidden from residents</p>}
                </div>
                {n.status !== "archived" && (
                  <div className="flex gap-2">
                    {editable && <Button variant={tab === "draft" ? "default" : "outline"} className="h-11 flex-1 rounded-xl md:flex-none" onClick={() => edit(n)}>{tab === "draft" ? "Continue" : "Edit"}</Button>}
                    <Button variant="ghost" className="h-11 rounded-xl text-muted-foreground" aria-label={`Archive ${n.title}`} onClick={() => archive(n.id)}><Archive className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Archive</span></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{form.id ? "Edit notice" : "New notice"}</SheetTitle></SheetHeader>
          <div className="space-y-4 py-4 max-w-2xl mx-auto">
            <div className="flex flex-wrap gap-2">
              {NOTICE_CATEGORIES.map((c) => (
                <button key={c.value} type="button" onClick={() => setForm({ ...form, category: c.value, schedule: c.value === "emergency" ? "" : form.schedule })}
                  className={cn("min-h-11 px-4 rounded-full border text-sm", form.category === c.value ? (c.value === "emergency" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary") : "border-border")}>
                  {c.label}
                </button>
              ))}
            </div>
            <div><Label htmlFor="n-title">Title *</Label><Input id="n-title" className="h-11" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="n-body">Message *</Label><Textarea id="n-body" rows={6} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Who should see it</Label>
                <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All residents</SelectItem>{(q.data?.blocks.length ?? 0) > 0 && <SelectItem value="block">One block</SelectItem>}</SelectContent>
                </Select>
              </div>
              {form.audience === "block" && (
                <div><Label>Block</Label>
                  <Select value={form.block_id} onValueChange={(v) => setForm({ ...form, block_id: v })}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Choose block" /></SelectTrigger>
                    <SelectContent>{q.data?.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {form.category !== "emergency" && !isLive && (
              <div><Label htmlFor="n-sched">Schedule (optional)</Label><Input id="n-sched" type="datetime-local" className="h-11" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} /></div>
            )}
            {form.category === "emergency" && <p className="text-xs text-destructive">Emergency notices publish immediately and are pinned at the top for residents. They appear in the app — phone push delivery isn't guaranteed.</p>}
            <div className="flex gap-2">
              {!isLive && <Button variant="outline" className="flex-1 h-12 rounded-xl" disabled={!!saving} onClick={() => save(false)}>{saving === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button>}
              <Button className={cn("flex-1 h-12 rounded-xl", form.category === "emergency" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")} disabled={!!saving} onClick={() => save(true)}>
                {saving === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : isLive ? "Save changes" : form.schedule ? "Schedule" : "Publish"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
