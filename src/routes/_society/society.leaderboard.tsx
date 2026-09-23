import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { LeaderboardList } from "@/components/gamification/Leaderboard";

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
          title="Leaderboard"
          description="Residents earn 2 points for each verified on-time maintenance payment. Pending or unverified payments never count."
        />
        <LeaderboardList limit={50} />
      </PageShell>
    </FeatureGate>
  );
}
