import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLE_HOME, ROLES } from "@/config/roles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SociyoHub — Society management, simplified" },
      {
        name: "description",
        content:
          "SociyoHub helps housing societies collect maintenance, share notices, and manage residents — all in one clean dashboard.",
      },
      { property: "og:title", content: "SociyoHub — Society management, simplified" },
      {
        property: "og:description",
        content:
          "SociyoHub helps housing societies collect maintenance, share notices, and manage residents — all in one clean dashboard.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://sociohub.live/" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
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
            {
              "@type": "Person",
              "@id": "https://sociohub.live/founders#meetarth-baldha",
              name: "Meetarth Baldha",
              jobTitle: "Co-Founder",
              url: "https://sociohub.live/founders#meetarth-baldha",
            },
            {
              "@type": "Person",
              "@id": "https://sociohub.live/founders#divyaraj-vaghela",
              name: "Divyaraj Vaghela",
              jobTitle: "Co-Founder",
              url: "https://sociohub.live/founders#divyaraj-vaghela",
            },
          ],
        }),
      },
    ],
  }),
  component: IndexRedirect,
});


function IndexRedirect() {
  const { isLoading, isAuthenticated, primaryRole, profile } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const seen = typeof window !== "undefined" && localStorage.getItem("sociohub:welcomed");
    return <Navigate to={seen ? "/login" : "/welcome"} replace />;
  }

  if (primaryRole === ROLES.SUPER_ADMIN) {
    return <Navigate to={ROLE_HOME[ROLES.SUPER_ADMIN]} replace />;
  }

  // Existing society admins/residents must never land on the create/join chooser.
  if (profile?.society_id && primaryRole) {
    return <Navigate to={ROLE_HOME[primaryRole]} replace />;
  }

  // Brand-new users without any society still land on onboarding.
  if (!profile?.society_id) {
    return <Navigate to="/onboarding" search={{} as any} replace />;
  }

  if (primaryRole) {
    return <Navigate to={ROLE_HOME[primaryRole]} replace />;
  }

  return <Navigate to="/onboarding" search={{} as any} replace />;
}
