import { createFileRoute, Link } from "@tanstack/react-router";
import { BRAND } from "@/config/brand";
import { SociyoHubLogo } from "@/components/shared/SociyoHubLogo";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: `About — ${BRAND.name}` },
      {
        name: "description",
        content: `${BRAND.name} is a society-management platform that simplifies resident services, maintenance, visitors and everyday housing-society operations.`,
      },
      { property: "og:title", content: `About — ${BRAND.name}` },
      {
        property: "og:description",
        content: `${BRAND.name} — ${BRAND.tagline}`,
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://sociohub.live/about" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/about" }],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-20 space-y-10">
        <header className="flex flex-col items-center text-center gap-4">
          <SociyoHubLogo size={32} showTagline />
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            About {BRAND.name}
          </h1>
        </header>

        <section className="space-y-4 text-muted-foreground">
          <p>
            {BRAND.name} is a mobile-first platform for Indian residential
            societies — apartments, gated communities and row-house layouts.
            We help committees collect maintenance, share notices, manage
            visitors and keep every resident in the loop from a single,
            secure app.
          </p>
          <p>
            Our product values are calm design, honest pricing and reliable
            fundamentals. Cash and Bank Transfer are first-class options for
            maintenance collection — no forced online gateway, no hidden
            platform fee.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Co-Founders</h2>
          <p className="text-muted-foreground mb-4">
            {BRAND.name} was co-founded by{" "}
            <strong>{BRAND.coFounders[0].name}</strong> and{" "}
            <strong>{BRAND.coFounders[1].name}</strong>.
          </p>
          <Link to="/founders" className="text-primary underline">
            Meet the co-founders →
          </Link>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Contact</h2>
          <p className="text-muted-foreground">
            Support:{" "}
            <a href={`mailto:${BRAND.supportEmail}`} className="text-primary underline">
              {BRAND.supportEmail}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
