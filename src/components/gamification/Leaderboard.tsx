import { useQuery } from "@tanstack/react-query";
import { Medal, RefreshCw, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toSafeFinanceError } from "@/lib/finance-safe-error";

export interface LeaderRow {
  rank: number;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  badge_count: number;
  is_me: boolean;
}

export const leaderboardQueryKey = ["gamification", "leaderboard"] as const;

export function useLeaderboard(limit = 20) {
  return useQuery({
    queryKey: [...leaderboardQueryKey, limit],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_society_leaderboard", { _limit: limit });
      if (error) throw error;
      return (data ?? []) as LeaderRow[];
    },
  });
}

const medalTone = ["text-warning", "text-muted-foreground", "text-accent-foreground"];

export function LeaderboardList({ limit = 20 }: { limit?: number }) {
  const q = useLeaderboard(limit);

  if (q.isPending) {
    return (
      <ul className="space-y-2" aria-busy="true" aria-label="Loading leaderboard">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i}><Skeleton className="h-14 w-full rounded-2xl" /></li>
        ))}
      </ul>
    );
  }

  if (q.isError) {
    const e = toSafeFinanceError(q.error, typeof navigator === "undefined" ? true : navigator.onLine);
    return (
      <div role="alert" className="rounded-2xl border bg-card p-5 text-center">
        <p className="font-semibold">{e.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{e.message}</p>
        {e.retryable && (
          <Button variant="outline" className="mt-4 min-h-11" disabled={q.isFetching} onClick={() => q.refetch()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Try again
          </Button>
        )}
      </div>
    );
  }

  if (q.data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
        <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-semibold">No points yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Points appear once on-time maintenance payments are verified by the committee.
        </p>
      </div>
    );
  }

  return (
    <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
      {q.data.map((r) => (
        <li
          key={r.rank}
          className={`flex min-h-14 items-center gap-3 px-4 py-3 ${r.is_me ? "bg-primary/5" : ""}`}
          aria-current={r.is_me ? "true" : undefined}
        >
          <span className="w-7 shrink-0 text-center">
            {r.rank <= 3 ? (
              <Medal className={`mx-auto h-5 w-5 ${medalTone[r.rank - 1]}`} aria-label={`Rank ${r.rank}`} />
            ) : (
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">{r.rank}</span>
            )}
          </span>
          <Avatar className="h-9 w-9 shrink-0">
            {r.avatar_url && <AvatarImage src={r.avatar_url} alt="" />}
            <AvatarFallback className="bg-primary/10 text-xs text-primary">
              {r.display_name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {r.display_name}
              {r.is_me && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">You</span>}
            </p>
            <p className="text-xs text-muted-foreground">{r.badge_count} {r.badge_count === 1 ? "badge" : "badges"}</p>
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums">{r.total_points} <span className="font-normal text-muted-foreground">pts</span></p>
        </li>
      ))}
    </ol>
  );
}
