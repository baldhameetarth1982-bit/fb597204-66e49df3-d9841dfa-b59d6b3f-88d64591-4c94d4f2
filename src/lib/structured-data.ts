import { BRAND } from "@/config/brand";

/**
 * Single source for public schema.org JSON-LD. Every public page emits the
 * same entity @ids so search/AI engines see one consistent graph, never
 * conflicting duplicates. Facts come only from BRAND (approved facts).
 */
const SITE = `https://${BRAND.domain}`;
export const LD_IDS = {
  website: `${SITE}/#website`,
  organization: `${SITE}/#organization`,
  product: `${SITE}/#app`,
  person: (slug: string) => `${SITE}/founders#${slug}`,
} as const;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function founders() {
  return BRAND.coFounders.map((f) => ({
    "@type": "Person",
    "@id": LD_IDS.person(slug(f.name)),
    name: f.name,
    jobTitle: f.role,
    url: LD_IDS.person(slug(f.name)),
    worksFor: { "@id": LD_IDS.organization },
  }));
}

function baseGraph() {
  return [
    {
      "@type": "WebSite",
      "@id": LD_IDS.website,
      name: BRAND.name,
      url: `${SITE}/`,
      inLanguage: "en-IN",
      publisher: { "@id": LD_IDS.organization },
    },
    {
      "@type": "Organization",
      "@id": LD_IDS.organization,
      name: BRAND.name,
      alternateName: BRAND.displayCompanyName,
      url: `${SITE}/`,
      slogan: BRAND.tagline,
      description: `${BRAND.name} is a society-management software platform for Indian residential societies.`,
      email: BRAND.supportEmail,
      logo: {
        "@type": "ImageObject",
        url: `${SITE}/__l5e/assets-v1/69d18846-1754-4422-9ca0-161f59a2293d/sociohub-logo-v2.png`,
      },
      founder: BRAND.coFounders.map((f) => ({ "@id": LD_IDS.person(slug(f.name)) })),
      owns: { "@id": LD_IDS.product },
    },
    {
      "@type": "SoftwareApplication",
      "@id": LD_IDS.product,
      name: BRAND.name,
      description:
        "Society management app for Indian apartment and residential societies: maintenance billing with Cash and Bank Transfer records, society accounts and expenses, notices, help-desk complaints, visitor and gate management, and resident communication.",
      url: `${SITE}/`,
      operatingSystem: "Web, Android",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Society management",
      areaServed: { "@type": "Country", name: "India" },
      inLanguage: "en-IN",
      publisher: { "@id": LD_IDS.organization },
    },
    ...founders(),
  ];
}

/** Returns a head() `scripts` entry holding the shared graph (+ optional page node). */
export function structuredDataScript(page?: { path: string; name: string; type?: "WebPage" | "AboutPage" | "ProfilePage" }) {
  const graph: Record<string, unknown>[] = baseGraph();
  if (page) {
    const url = `${SITE}${page.path}`;
    graph.push({
      "@type": page.type ?? "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: page.name,
      isPartOf: { "@id": LD_IDS.website },
      about: { "@id": LD_IDS.organization },
      ...(page.type === "ProfilePage"
        ? { mainEntity: BRAND.coFounders.map((f) => ({ "@id": LD_IDS.person(slug(f.name)) })) }
        : {}),
    });
  }
  return {
    type: "application/ld+json",
    children: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c"),
  };
}
