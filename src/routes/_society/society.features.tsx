import { createFileRoute } from "@tanstack/react-router";
import { FeatureDirectory } from "@/components/features/FeatureDirectory";

export const Route = createFileRoute("/_society/society/features")({
  head: () => ({
    meta: [
      { title: "Feature Directory — SocioHub" },
      {
        name: "description",
        content: "Discover every SocioHub feature available to your society, with plan and status.",
      },
    ],
  }),
  component: () => <FeatureDirectory role="society_admin" />,
});
