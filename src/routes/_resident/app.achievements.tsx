import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, MessageSquare, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/lib/i18n-format";
import { LeaderboardList, useLeaderboard } from "@/components/gamification/Leaderboard";

export const Route = createFileRoute("/_resident/app/achievements")({
  head: () => ({
    meta: [
      { title: "Points & Leaderboard — SociyoHub" },
      { name: "description", content: "Your points from verified on-time maintenance payments and your society ranking." },
    ],
  }),
  component: () => (
    <FeatureGate feature="gamification">
      <AchievementsScreen />
    </FeatureGate>
  ),
});

const REASON_KEY: Record<string, string> = {
  on_time_payment: "ach.r.onTime",
  post_created: "ach.r.post",
};

function AchievementsScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const board = useLeaderboard(20);
  const me = board.data?.find((r) => r.is_me);

  // Own history only — enforced by row-level access on the points table.
  const history = useQuery({
    queryKey: ["gamification", "my-points", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_points")
        .select("id, points, reason, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 pb-28 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("ach.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("ach.subtitle")}</p>
      </header>

      <section className="rounded-3xl bg-primary p-6 text-primary-foreground shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider opacity-80">{t("ach.yours")}</p>
        {board.isPending ? (
          <Skeleton className="mt-2 h-10 w-24 bg-primary-foreground/20" />
        ) : (
          <p className="mt-1 text-4xl font-bold tabular-nums">{me?.total_points ?? 0}</p>
        )}
        <p className="mt-1 text-sm opacity-80">
          {me ? t("ach.rank", { rank: me.rank }) : t("ach.join")}
        </p>
      </section>

      <section aria-labelledby="how" className="rounded-2xl border bg-card p-4">
        <h2 id="how" className="text-sm font-semibold">{t("ach.how")}</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {t("ach.rule1")}</li>
          <li className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0" /> {t("ach.rule2")}</li>
          <li className="flex gap-2"><Trophy className="mt-0.5 h-4 w-4 shrink-0" /> {t("ach.rule3")}</li>
        </ul>
      </section>

      <section aria-labelledby="lb">
        <h2 id="lb" className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("ach.board")}</h2>
        <LeaderboardList limit={20} />
      </section>

      <section aria-labelledby="hist">
        <h2 id="hist" className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("ach.history")}</h2>
        {history.isPending ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : history.isError ? (
          <p role="alert" className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("ach.loadFailed")}</p>
        ) : history.data.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">{t("ach.none")}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {history.data.map((h) => (
              <li key={h.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                {h.reason === "post_created" ? <MessageSquare className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t(REASON_KEY[h.reason] ?? "ach.r.other")}</p>
                  <p className="text-xs text-muted-foreground">{fmt.date(h.created_at, { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${h.points < 0 ? "text-destructive" : ""}`}>{h.points > 0 ? "+" : ""}{h.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
