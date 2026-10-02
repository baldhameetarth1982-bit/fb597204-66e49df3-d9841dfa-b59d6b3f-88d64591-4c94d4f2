import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { BooksPage } from "@/components/finance/BooksWorkspace";

export const Route = createFileRoute("/_society/society/books")({
  head: () => ({ meta: [
    { title: "Books & Tax — SociyoHub" },
    { name: "description", content: "Manual journals, trial balance, income & expenditure, balance sheet, year close, Tally-ready export and GST/TDS." },
    { property: "og:title", content: "Books & Tax — SociyoHub" },
    { property: "og:description", content: "Formal society accounts built from the posted ledger." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <FeatureGate feature="accounts_center"><BooksPage /></FeatureGate>,
});
