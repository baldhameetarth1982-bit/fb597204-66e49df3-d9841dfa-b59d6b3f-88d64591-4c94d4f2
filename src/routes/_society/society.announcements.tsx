import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Megaphone, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/announcements")({
  head: () => ({ meta: [{ title: "Announcements — SocioHub" }] }),
  component: AnnouncementsPage,
});

interface PostRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author?: { full_name: string | null } | null;
}

function AnnouncementsPage() {
  const { user } = useAuth();
  const { societyId, loading: sidLoading } = useSocietyId();
  const [rows, setRows] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function load() {
    if (!societyId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select("id, body, created_at, author_id, author:profiles!posts_author_id_fkey(full_name)")
      .eq("society_id", societyId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRows((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, [societyId]);

  async function publish() {
    if (!user || !societyId) return;
    const text = body.trim();
    if (!text) return toast.error("Write something first");
    setPosting(true);
    const { error } = await supabase.from("posts").insert({
      society_id: societyId, author_id: user.id, body: text,
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    toast.success("Announcement posted");
    setBody(""); setOpen(false);
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  if (sidLoading || loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Announcements"
        description="Broadcast notices to all residents of your society."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl h-11">
                <Plus className="h-4 w-4 mr-2" /> New announcement
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New announcement</DialogTitle></DialogHeader>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="E.g. Water tank cleaning scheduled for Saturday 9am–12pm..."
                rows={6}
                className="rounded-xl"
              />
              <DialogFooter>
                <Button onClick={publish} disabled={posting} className="rounded-xl">
                  {posting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="Post your first notice — it appears in every resident's feed."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="rounded-2xl">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {r.author?.full_name ?? "Admin"} • {new Date(r.created_at).toLocaleString()}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-foreground">{r.body}</p>
                  </div>
                  {r.author_id === user?.id && (
                    <Button
                      size="icon" variant="ghost"
                      onClick={() => remove(r.id)}
                      className="text-destructive hover:bg-destructive/10 rounded-xl"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
