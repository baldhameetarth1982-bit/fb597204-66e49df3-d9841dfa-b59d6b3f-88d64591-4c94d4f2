import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Vote, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_resident/app/polls")({
  head: () => ({ meta: [{ title: "Polls — SocioHub" }] }),
  component: PollsPage,
});

interface Poll {
  id: string;
  title: string;
  description: string | null;
  status: string;
  closes_at: string | null;
}
interface Opt { id: string; poll_id: string; label: string; position: number }
interface Vote { poll_id: string; option_id: string; user_id: string }

function PollsPage() {
  const { user } = useAuth();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [options, setOptions] = useState<Opt[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: ps } = await supabase.from("polls").select("id,title,description,status,closes_at").order("created_at", { ascending: false });
    const pollList = (ps as Poll[]) ?? [];
    setPolls(pollList);
    if (pollList.length) {
      const ids = pollList.map((p) => p.id);
      const [{ data: os }, { data: vs }] = await Promise.all([
        supabase.from("poll_options").select("id,poll_id,label,position").in("poll_id", ids).order("position"),
        supabase.from("poll_votes").select("poll_id,option_id,user_id").in("poll_id", ids),
      ]);
      setOptions((os as Opt[]) ?? []);
      setVotes((vs as Vote[]) ?? []);
    } else {
      setOptions([]);
      setVotes([]);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const myVotes = useMemo(() => {
    const m = new Map<string, string>();
    if (!user) return m;
    votes.filter((v) => v.user_id === user.id).forEach((v) => m.set(v.poll_id, v.option_id));
    return m;
  }, [votes, user]);

  async function castVote(pollId: string, optionId: string) {
    if (!user) return;
    setVoting(pollId);
    const { error } = await supabase.from("poll_votes").insert({ poll_id: pollId, option_id: optionId, user_id: user.id });
    setVoting(null);
    if (error) return toast.error(error.message);
    toast.success("Vote recorded");
    void load();
  }

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Polls & Elections</h1>
        <p className="text-sm text-muted-foreground">Vote on community decisions</p>
      </header>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : polls.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center text-sm text-muted-foreground">No polls yet</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {polls.map((p) => {
            const opts = options.filter((o) => o.poll_id === p.id);
            const pollVotes = votes.filter((v) => v.poll_id === p.id);
            const total = pollVotes.length;
            const myChoice = myVotes.get(p.id);
            const closed = p.status !== "open";
            return (
              <Card key={p.id} className="rounded-2xl">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="h-10 w-10 rounded-2xl bg-primary/10 grid place-items-center text-primary shrink-0">
                      <Vote className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{p.title}</p>
                        {closed ? (
                          <Badge variant="secondary" className="rounded-full text-[10px]">Closed</Badge>
                        ) : (
                          <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Live</Badge>
                        )}
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {opts.map((o) => {
                      const c = pollVotes.filter((v) => v.option_id === o.id).length;
                      const pct = total ? Math.round((c / total) * 100) : 0;
                      const mine = myChoice === o.id;
                      const showResults = !!myChoice || closed;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={!!myChoice || closed || voting === p.id}
                          onClick={() => castVote(p.id, o.id)}
                          className={`relative w-full text-left rounded-xl border ${mine ? "border-primary" : "border-border"} px-3 py-2.5 overflow-hidden disabled:opacity-100`}
                        >
                          {showResults && (
                            <div
                              className={`absolute inset-y-0 left-0 ${mine ? "bg-primary/15" : "bg-secondary"}`}
                              style={{ width: `${pct}%` }}
                            />
                          )}
                          <div className="relative flex items-center justify-between gap-2">
                            <span className="text-sm font-medium flex items-center gap-2">
                              {mine && <CheckCircle2 className="h-4 w-4 text-primary" />}
                              {o.label}
                            </span>
                            {showResults && (
                              <span className="text-xs font-semibold text-muted-foreground">{pct}% · {c}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    {total} vote{total === 1 ? "" : "s"}
                    {p.closes_at && ` · closes ${new Date(p.closes_at).toLocaleDateString()}`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
