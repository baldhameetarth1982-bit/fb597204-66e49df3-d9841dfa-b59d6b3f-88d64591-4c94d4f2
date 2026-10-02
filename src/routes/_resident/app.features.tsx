import { createFileRoute } from "@tanstack/react-router";
import { FeatureDirectory } from "@/components/features/FeatureDirectory";

export const Route = createFileRoute("/_resident/app/features")({
  head: () => ({
    meta: [
      { title: "Feature Directory — SociyoHub" },
      {
        name: "description",
        content: "Discover every SociyoHub feature available to you, with plan and status.",
      },
    ],
  }),
  component: () => <FeatureDirectory role="resident" />,
});
