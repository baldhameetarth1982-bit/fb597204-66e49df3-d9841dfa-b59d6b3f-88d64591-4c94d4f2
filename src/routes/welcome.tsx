import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/landing/Landing";

const TITLE = "SociyoHub — Society management, simplified";
const DESC =
  "Maintenance billing, notices, residents, visitors and society documents for Indian housing societies — in one calm, organised app.";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/" }],
  }),
  component: Landing,
});
