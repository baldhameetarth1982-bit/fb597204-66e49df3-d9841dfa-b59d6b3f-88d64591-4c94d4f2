import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { LeaderboardList } from "@/components/gamification/Leaderboard";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — SociyoHub" },
      { name: "description", content: "Society leaderboard from verified on-time maintenance payments." },
    ],
  }),
  component: Leaderboard,
});

function Leaderboard() {
  return (
    <FeatureGate feature="leaderboard">
      <PageShell>
        <PageHeader
          title={tu("nav.leaderboard")}
          description={tu("op.residents_earn_2_points_for")}
        />
        <LeaderboardList limit={50} />
      </PageShell>
    </FeatureGate>
  );
}
