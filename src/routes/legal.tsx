import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, FileText, RefreshCw, PhoneCall, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/legal")({
  head: () => ({
    meta: [
      { title: "Legal Center — SocioHub" },
      { name: "description", content: "Privacy Policy, Terms of Service, Refund Policy and Grievance contact for SocioHub." },
      { property: "og:title", content: "SocioHub Legal Center" },
      { property: "og:description", content: "Policies and grievance contact for SocioHub, a SaaS platform for housing societies." },
    ],
  }),
  component: LegalCenter,
});

const cards = [
  { to: "/privacy", icon: ShieldCheck, title: "Privacy Policy", desc: "What data we collect and how we protect it." },
  { to: "/terms", icon: FileText, title: "Terms & Conditions", desc: "The rules of using SocioHub as a SaaS platform." },
  { to: "/refund", icon: RefreshCw, title: "Refund & Cancellation", desc: "How refunds work for maintenance and plans." },
  { to: "/contact", icon: PhoneCall, title: "Contact & Grievance", desc: "Reach our Grievance Officer within 48 hours." },
] as const;

function LegalCenter() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-4xl mx-auto w-full px-5 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <header className="mt-4 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Legal Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated: July 2026 · Maintained by SocioHub.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="group">
              <Card className="rounded-2xl h-full transition hover:border-primary/50">
                <CardContent className="p-5 flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                    <c.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold group-hover:text-primary">{c.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{c.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-6 rounded-2xl">
          <CardContent className="p-5 text-sm text-muted-foreground leading-relaxed">
            <p>
              SocioHub is a Software-as-a-Service platform used by housing societies to manage residents, maintenance
              dues, notices, visitors and community activity. SocioHub is <strong>not</strong> the society administration —
              each society controls its own data, roles, and community content within the platform.
            </p>
            <p className="mt-3">
              For any legal or compliance query, contact the Grievance Officer at{" "}
              <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
            </p>
          </CardContent>
        </Card>
      </main>
      <LegalFooter />
    </div>
  );
}
