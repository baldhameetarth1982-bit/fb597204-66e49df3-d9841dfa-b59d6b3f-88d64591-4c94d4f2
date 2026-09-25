import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SociyoHubLogo } from "@/components/shared/SociyoHubLogo";

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
  }),
  component: Landing,
});

const capabilities = [
  { icon: Wallet, title: "Maintenance billing", body: "Generate bills, record Cash and Bank Transfer payments, and see exactly who is outstanding." },
  { icon: Bell, title: "Notices & polls", body: "Share announcements and run polls that every resident actually sees." },
  { icon: Users, title: "Residents & flats", body: "Wings, flats, owners, tenants and families — organised and searchable." },
  { icon: FileText, title: "Documents & AI Secretary", body: "Bylaws and FAQs in one place, with answers drawn only from your society's documents." },
];

const workflows = [
  { step: "01", title: "Set up your society", body: "Add wings and flats once. Invite residents with a society code." },
  { step: "02", title: "Run monthly billing", body: "Bills go out on schedule. Committee verifies payments against a clear ledger." },
  { step: "03", title: "Stay in touch", body: "Notices, visitors, helpdesk and community — without scattered WhatsApp groups." },
];

const trust = [
  "Every society's data is kept separate",
  "Verified payment history is never deleted",
  "Committee roles control who sees what",
  "No platform fee on maintenance",
];

function Landing() {
  const navigate = useNavigate();
  function start() {
    try { localStorage.setItem("sociohub:welcomed", "1"); } catch {}
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="container-page flex h-16 items-center justify-between">
        <SociyoHubLogo size={26} />
        <div className="flex items-center gap-2">
          <Link to="/pricing" className="hidden sm:inline-flex h-11 items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <Button variant="outline" className="h-11" onClick={start}>Sign in</Button>
        </div>
      </header>

      {/* Hero — typography only, no imagery */}
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="landing-grid pointer-events-none absolute inset-0" />
        <div className="container-page relative grid gap-10 py-16 md:py-24 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden />
              For Indian housing societies
            </p>
            <h1 className="type-hero mt-6">
              Society management,{" "}
              <span className="text-primary">simplified.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              SociyoHub gives your committee one place to bill maintenance, reach residents and keep society records in order — so the society runs itself, not your evenings.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 px-6 text-base" onClick={start}>
                Get started <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base">
                <Link to="/pricing">See plans</Link>
              </Button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:col-span-4 lg:grid-cols-1">
            {[
              ["Billing", "Cash & Bank Transfer"],
              ["Access", "Role-based committee"],
              ["Records", "Append-only ledger"],
              ["Platform fee", "None"],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Capabilities */}
      <section className="container-page py-16 md:py-20">
        <div className="max-w-2xl">
          <h2 className="type-section">Everything the committee handles, in one place</h2>
          <p className="mt-3 text-muted-foreground">Four areas that take up most of a society's time.</p>
        </div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-card p-6">
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflows */}
      <section className="border-y border-border bg-card">
        <div className="container-page py-16 md:py-20">
          <h2 className="type-section max-w-2xl">How societies use SociyoHub</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {workflows.map((w) => (
              <li key={w.step} className="border-t-2 border-primary pt-4">
                <span className="font-mono text-xs text-muted-foreground">{w.step}</span>
                <h3 className="mt-2 text-base font-semibold">{w.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section className="container-page grid gap-10 py-16 md:grid-cols-2 md:py-20">
        <div>
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
          <h2 className="type-section mt-4">Built for money and trust</h2>
          <p className="mt-3 max-w-md text-muted-foreground">
            Society finances need to be correct and accountable. SociyoHub is designed around that from the start.
          </p>
        </div>
        <ul className="grid gap-3 self-center">
          {trust.map((t) => (
            <li key={t} className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="container-page pb-16 md:pb-24">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-foreground px-6 py-10 text-background md:flex-row md:items-center md:px-10">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Ready to simplify your society?</h2>
            <p className="mt-2 text-sm opacity-75">Sign in or create your society in a few minutes.</p>
          </div>
          <Button size="lg" className="h-12 px-6 text-base" onClick={start}>
            Get started <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© SociyoHub Technologies</span>
          <nav className="flex flex-wrap gap-4">
            <Link to="/about" className="hover:text-foreground">About</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/contact" className="hover:text-foreground">Contact</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
