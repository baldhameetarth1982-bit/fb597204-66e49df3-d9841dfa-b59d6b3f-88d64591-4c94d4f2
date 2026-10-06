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
import { tu } from "@/lib/i18n";

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

const capabilities = [
  { icon: Users, title: "Residents & households", body: "Owners, tenants, family, pets, domestic help, temporary occupants, multiple homes, home history and No-Dues." },
  { icon: Users, title: "Owner & tenant lifecycle", body: "Move-in, lease agreements, renewals, reminders and move-out — with history that is never overwritten." },
  { icon: Wallet, title: "Bills & dues", body: "Recurring and one-off bills, arrears, late fees and defaulters. Pay by Cash, Bank Transfer, UPI QR or online Pay now." },
  { icon: Wallet, title: "Finance & accounting", body: "Receipts, income, expenses, ledger, journals, trial balance, balance sheet, GST/TDS, year close, Auditor Pack and Tally export." },
  { icon: Building2, title: "Procurement & budgets", body: "Requests, quotations, approvals, purchase orders, vendor invoices and budgets linked to real expenses." },
  { icon: ShieldCheck, title: "Gate, visitors & security", body: "Visitor approvals, pass codes, guard shifts, patrol rounds, SOS, child/elder safety and emergency broadcasts." },
  { icon: ShieldCheck, title: "Parking & EV", body: "Slots, vehicles, violations with photos and EV charging sessions." },
  { icon: Building2, title: "Amenities & classes", body: "Booking, eligibility rules, waitlists, classes, instructors, QR check-in and reminders." },
  { icon: Building2, title: "Operations, helpdesk & staff", body: "Helpdesk with SLAs, staff attendance, vendors and ratings, assets, maintenance schedules and inventory." },
  { icon: Bell, title: "Governance", body: "Notices with acknowledgements, meetings and minutes, AGM, secret-ballot elections, votes and surveys." },
  { icon: Bell, title: "Community", body: "Groups, events with RSVP, marketplace, and Services & Discovery." },
  { icon: FileText, title: "Documents, AI & importing", body: "Private document vault, an AI Secretary that answers only from your society's documents, and guided import from spreadsheets, MyGate, ADDA or NoBrokerHood." },
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
            {tu("op.pricing")}
          </Link>
          <Button variant="outline" className="h-11" onClick={start}>{tu("auth.signIn")}</Button>
        </div>
      </header>

      {/* Hero — typography only, no imagery */}
      <section className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="landing-grid pointer-events-none absolute inset-0" />
        <div className="container-page relative grid gap-10 py-16 md:py-24 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden />
              {tu("op.for_indian_housing_societies")}
            </p>
            <h1 className="type-hero mt-6">
              {tu("op.society_management")}{" "}
              <span className="text-primary">simplified.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {tu("op.sociyohub_gives_your_committee_one")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 px-6 text-base" onClick={start}>
                {tu("op.get_started")} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base">
                <Link to="/pricing">{tu("sec.seePlans")}</Link>
              </Button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:col-span-4 lg:grid-cols-1">
            {[
              ["Payments", "Cash, Bank, UPI QR, Online"],
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
          <h2 className="type-section">{tu("op.everything_the_committee_handles_in")}</h2>
          <p className="mt-3 text-muted-foreground">{tu("op.four_areas_that_take_up")}</p>
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
          <h2 className="type-section max-w-2xl">{tu("op.how_societies_use_sociyohub")}</h2>
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
          <h2 className="type-section mt-4">{tu("op.built_for_money_and_trust")}</h2>
          <p className="mt-3 max-w-md text-muted-foreground">
            {tu("op.society_finances_need_to_be")}
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
            <h2 className="text-2xl font-semibold tracking-tight">{tu("op.ready_to_simplify_your_society")}</h2>
            <p className="mt-2 text-sm opacity-75">{tu("op.sign_in_or_create_your")}</p>
          </div>
          <Button size="lg" className="h-12 px-6 text-base" onClick={start}>
            {tu("op.get_started")} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© SociyoHub Technologies</span>
          <nav className="flex flex-wrap gap-4">
            <Link to="/about" className="hover:text-foreground">{tu("op.about_2")}</Link>
            <Link to="/privacy" className="hover:text-foreground">{tu("auth.privacy")}</Link>
            <Link to="/terms" className="hover:text-foreground">{tu("auth.terms")}</Link>
            <Link to="/contact" className="hover:text-foreground">{tu("op.contact")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
