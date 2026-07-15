import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Vote, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageShell, PageHeader } from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/polls")({
  head: () => ({ meta: [{ title: "Polls — SociyoHub" }] }),
  component: () => (<FeatureGate feature="polls"><AdminPolls /></FeatureGate>),
});

interface Poll {
  id: string; title: string; description: string | null;
  status: string; closes_at: string | null; created_at: string;
}
interface Opt { id: string; poll_id: string; label: string; position: number }

function AdminPolls() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [options, setOptions] = useState<Opt[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", options: ["", ""] });

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data: ps } = await supabase
      .from("polls").select("id,title,description,status,closes_at,created_at")
      .eq("society_id", societyId).order("created_at", { ascending: false });
    const list = (ps as Poll[]) ?? [];
    setPolls(list);
    if (list.length) {
      const ids = list.map((p) => p.id);
      const [{ data: os }, { data: vs }] = await Promise.all([
        supabase.from("poll_options").select("id,poll_id,label,position").in("poll_id", ids).order("position"),
        supabase.from("poll_votes").select("poll_id").in("poll_id", ids),
      ]);
      setOptions((os as Opt[]) ?? []);
      const c: Record<string, number> = {};
      (vs ?? []).forEach((v: { poll_id: string }) => { c[v.poll_id] = (c[v.poll_id] ?? 0) + 1; });
      setCounts(c);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [societyId]);

  async function createPoll(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !user) return;
    const opts = form.options.map((s) => s.trim()).filter(Boolean);
    if (!form.title.trim() || opts.length < 2) {
      toast.error("Title and at least 2 options required");
      return;
    }
    setSubmitting(true);
    const { data: poll, error } = await supabase.from("polls").insert({
      society_id: societyId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      created_by: user.id,
    }).select("id").single();
    if (error || !poll) {
      setSubmitting(false);
      return toast.error(error?.message || "Failed");
    }
    const { error: oerr } = await supabase.from("poll_options").insert(
      opts.map((label, i) => ({ poll_id: poll.id, label, position: i }))
    );
    setSubmitting(false);
    if (oerr) return toast.error(oerr.message);
    toast.success("Poll created");
    setForm({ title: "", description: "", options: ["", ""] });
    setOpen(false);
    void load();
  }

  async function closePoll(id: string) {
    const { error } = await supabase.from("polls").update({ status: "closed" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Poll closed");
    void load();
  }

  return (
    <PageShell>
      <PageHeader
        title="Polls & Elections"
        description="Create polls for residents to vote on"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl"><Plus className="h-4 w-4 mr-1" /> New poll</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create poll</DialogTitle></DialogHeader>
              <form onSubmit={createPoll} className="space-y-3">
                <div>
                  <Label>Title</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="New paint colour" required />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional context" />
                </div>
                <div>
                  <Label>Options</Label>
                  <div className="space-y-2">
                    {form.options.map((o, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={o}
                          onChange={(e) => {
                            const n = [...form.options]; n[i] = e.target.value; setForm({ ...form, options: n });
                          }}
                          placeholder={`Option ${i + 1}`}
                        />
                        {form.options.length > 2 && (
                          <Button type="button" size="icon" variant="ghost" onClick={() => setForm({ ...form, options: form.options.filter((_, x) => x !== i) })}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setForm({ ...form, options: [...form.options, ""] })}>
                      <Plus className="h-4 w-4 mr-1" /> Add option
                    </Button>
                  </div>
                </div>
                <Button type="submit" className="w-full rounded-xl" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : polls.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-10 text-center text-sm text-muted-foreground">No polls yet</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {polls.map((p) => {
            const opts = options.filter((o) => o.poll_id === p.id);
            const total = counts[p.id] ?? 0;
            return (
              <Card key={p.id} className="rounded-2xl">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-primary/10 grid place-items-center text-primary"><Vote className="h-5 w-5" /></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{p.title}</p>
                        {p.status === "open" ? (
                          <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Live</Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full text-[10px]">Closed</Badge>
                        )}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      <p className="text-[11px] text-muted-foreground mt-1">{total} votes · {opts.length} options</p>
                    </div>
                    {p.status === "open" && (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => closePoll(p.id)}>
                        <Lock className="h-3.5 w-3.5 mr-1" /> Close
                      </Button>
                    )}
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 pl-1">
                    {opts.map((o) => <li key={o.id}>· {o.label}</li>)}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
