import { createFileRoute } from "@tanstack/react-router";
import { CommHeader, CommPage } from "@/components/comm/CommUI";
import { ResidentPasses } from "@/features/passes/MaterialPasses";
import { tu } from "@/lib/i18n";

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
      <CommHeader title={tu("op.passes_lift")} subtitle={tu("op.material_construction_and_move_passes")} />
      <ResidentPasses />
    </CommPage>
  ),
});
