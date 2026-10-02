import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AuditorPackPage } from "@/components/finance/AuditorPackWorkspace";

export const Route = createFileRoute("/_society/society/auditor-pack")({
  head: () => ({ meta: [
    { title: "Auditor Pack — SociyoHub" },
    { name: "description", content: "Prepare a traceable financial evidence pack for a reporting period." },
    { property: "og:title", content: "Auditor Pack — SociyoHub" },
    { property: "og:description", content: "Traceable financial evidence from the society's canonical records." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <FeatureGate feature="advanced_reports"><AuditorPackPage /></FeatureGate>,
});
