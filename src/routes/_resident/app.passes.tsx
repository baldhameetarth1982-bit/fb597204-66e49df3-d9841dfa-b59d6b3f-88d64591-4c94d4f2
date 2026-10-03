import { createFileRoute } from "@tanstack/react-router";
import { CommHeader, CommPage } from "@/components/comm/CommUI";
import { ResidentPasses } from "@/features/passes/MaterialPasses";

export const Route = createFileRoute("/_resident/app/passes")({
  head: () => ({
    meta: [
      { title: "Material & move passes — SociyoHub" },
      { name: "description", content: "Request material, construction and move passes and book the service lift." },
      { property: "og:title", content: "Material & move passes — SociyoHub" },
      { property: "og:description", content: "Gate passes and service lift booking for your home." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <CommPage>
      <CommHeader title="Passes & lift" subtitle="Material, construction and move passes, with service lift booking" />
      <ResidentPasses />
    </CommPage>
  ),
});
