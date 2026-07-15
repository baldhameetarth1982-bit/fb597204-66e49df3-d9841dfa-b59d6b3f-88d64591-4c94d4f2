import { createFileRoute, Link } from "@tanstack/react-router";
import { BRAND } from "@/config/brand";
import { SociyoHubLogo } from "@/components/shared/SociyoHubLogo";

export const Route = createFileRoute("/founders")({
  head: () => ({
    meta: [
      { title: "Meetarth Baldha and Divyaraj Vaghela — Co-Founders of SociyoHub" },
      {
        name: "description",
        content:
          "Meetarth Baldha and Divyaraj Vaghela co-founded SociyoHub, a society-management platform simplifying community administration and resident services.",
      },
      {
        property: "og:title",
        content: "Meetarth Baldha and Divyaraj Vaghela — Co-Founders of SociyoHub",
      },
      {
        property: "og:description",
        content:
          "The equal co-founders behind SociyoHub, the society-management platform.",
      },
      { property: "og:type", content: "profile" },
      { property: "og:url", content: "https://sociohub.live/founders" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/founders" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://sociohub.live/#organization",
              name: "SociyoHub",
              url: "https://sociohub.live/",
              description: "SociyoHub is a society-management software platform.",
              logo: {
                "@type": "ImageObject",
                url: "https://sociohub.live/__l5e/assets-v1/69d18846-1754-4422-9ca0-161f59a2293d/sociohub-logo-v2.png",
              },
              founder: [
                { "@id": "https://sociohub.live/founders#meetarth-baldha" },
                { "@id": "https://sociohub.live/founders#divyaraj-vaghela" },
              ],
            },
            {
              "@type": "Person",
              "@id": "https://sociohub.live/founders#meetarth-baldha",
              name: "Meetarth Baldha",
              jobTitle: "Co-Founder",
              url: "https://sociohub.live/founders#meetarth-baldha",
              worksFor: { "@id": "https://sociohub.live/#organization" },
            },
            {
              "@type": "Person",
              "@id": "https://sociohub.live/founders#divyaraj-vaghela",
              name: "Divyaraj Vaghela",
              jobTitle: "Co-Founder",
              url: "https://sociohub.live/founders#divyaraj-vaghela",
              worksFor: { "@id": "https://sociohub.live/#organization" },
            },
          ],
        }),
      },
    ],

  }),
  component: FoundersPage,
});

function FoundersPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-20">
        <div className="mb-10 flex flex-col items-center text-center gap-4">
          <SociyoHubLogo size={30} />
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">
            Co-Founders of SociyoHub
          </h1>
          <p className="max-w-2xl text-base md:text-lg text-muted-foreground">
            Meetarth Baldha and Divyaraj Vaghela co-founded SociyoHub, a
            society-management platform designed to simplify community
            administration, resident services and everyday housing-society
            operations.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {BRAND.coFounders.map((f) => (
            <article
              key={f.name}
              className="rounded-2xl border border-border bg-card p-8 shadow-sm flex flex-col items-center text-center"
            >
              <div
                className="mb-5 flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-primary-foreground"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.colors.navy}, ${BRAND.colors.teal})`,
                }}
                aria-hidden="true"
              >
                {f.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </div>
              <h2 className="text-xl font-semibold text-foreground">{f.name}</h2>
              <p className="mt-1 text-sm font-medium text-primary">{f.role}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Co-Founder of {BRAND.name}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link to="/about" className="text-primary underline text-sm">
            Learn more about {BRAND.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
