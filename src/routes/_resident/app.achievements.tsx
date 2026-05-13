import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Trophy, Award, Sparkles, Loader2, Crown, Medal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/achievements")({
  head: () => ({ meta: [{ title: "Achievements — SocioHub" }] }),
  component: AchievementsScreen,
});

interface LBRow {
  user_id: string; full_name: string | null; avatar_url: string | null;
  total_points: number; achievement_count: number;
}
interface Achv { code: string; title: string; description: string | null; awarded_at: string; }

const ALL_BADGES: { code: string; title: string; description: string; icon: typeof Trophy }[] = [
  { code: "on_time_payer", title: "On-Time Payer", description: "Paid maintenance before due date", icon: Trophy },
  { code: "community_voice", title: "Community Voice", description: "Posted 10+ updates to the feed", icon: Sparkles },
  { code: "active_voter", title: "Active Voter", description: "Voted in every poll this quarter", icon: Award },
];

function initials(n?: string | null) {
  return (n ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function AchievementsScreen() {
  const { societyId } = useSocietyId();
  const { user } = useAuth();
  const [lb, setLb] = useState<LBRow[]>([]);
  const [mine, setMine] = useState<Achv[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId || !user) return;
    (async () => {
      const [{ data: lbData }, { data: achvs }] = await Promise.all([
        supabase
          .from("society_leaderboard" as any)
          .select("user_id, full_name, avatar_url, total_points, achievement_count")
          .eq("society_id", societyId)
          .order("total_points", { ascending: false })
          .limit(20),
        supabase
          .from("achievements")
          .select("code, title, description, awarded_at")
          .eq("user_id", user.id)
          .eq("society_id", societyId),
      ]);
      setLb((lbData as any[]) ?? []);
      setMine((achvs as Achv[]) ?? []);
      setLoading(false);
    })();
  }, [societyId, user?.id]);

  const myRow = useMemo(() => lb.find((r) => r.user_id === user?.id), [lb, user?.id]);
  const myRank = useMemo(() => {
    const idx = lb.findIndex((r) => r.user_id === user?.id);
    return idx >= 0 ? idx + 1 : null;
  }, [lb, user?.id]);

  const earnedCodes = new Set(mine.map((m) => m.code));

  return (
    <div className="px-5 py-6 space-y-5 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Achievements</h1>
        <p className="text-sm text-muted-foreground">Earn points for being a great neighbor</p>
      </header>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : (
        <>
          <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-amber-500 to-orange-500 text-white">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider opacity-90">Your score</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums">{myRow?.total_points ?? 0}</p>
                  <p className="text-xs opacity-90 mt-1">
                    {myRank ? `Rank #${myRank} in your society` : "Earn points to enter the leaderboard"}
                  </p>
                </div>
                <Crown className="h-12 w-12 opacity-30" />
              </div>
            </CardContent>
          </Card>

          {/* Badges */}
          <section>
            <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Badges
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {ALL_BADGES.map((b) => {
                const earned = earnedCodes.has(b.code);
                const Icon = b.icon;
                return (
                  <Card key={b.code} className={`rounded-2xl ${earned ? "" : "opacity-40"}`}>
                    <CardContent className="p-3 text-center">
                      <div className={`mx-auto h-12 w-12 rounded-2xl grid place-items-center mb-2 ${
                        earned ? "bg-amber-500/20 text-amber-600" : "bg-muted text-muted-foreground"
                      }`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <p className="text-[11px] font-semibold leading-tight">{b.title}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Leaderboard */}
          <section>
            <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Society Leaderboard
            </h2>
            <Card className="rounded-2xl">
              <CardContent className="p-2">
                {lb.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No points scored yet. Make a payment or post to start!
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {lb.map((row, i) => {
                      const me = row.user_id === user?.id;
                      const rank = i + 1;
                      const medal =
                        rank === 1 ? "text-amber-500" :
                        rank === 2 ? "text-zinc-400" :
                        rank === 3 ? "text-orange-700" : "";
                      return (
                        <li key={row.user_id} className={`flex items-center gap-3 p-2.5 ${me ? "bg-primary/5 rounded-xl" : ""}`}>
                          <div className="w-7 text-center">
                            {rank <= 3 ? (
                              <Medal className={`h-5 w-5 mx-auto ${medal}`} />
                            ) : (
                              <span className="text-sm font-semibold text-muted-foreground tabular-nums">{rank}</span>
                            )}
                          </div>
                          <Avatar className="h-9 w-9">
                            {row.avatar_url && <AvatarImage src={row.avatar_url} />}
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {initials(row.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {row.full_name ?? "Resident"} {me && <Badge variant="secondary" className="ml-1 rounded-full text-[9px]">You</Badge>}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{row.achievement_count} badges</p>
                          </div>
                          <p className="text-sm font-bold tabular-nums">{row.total_points}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
