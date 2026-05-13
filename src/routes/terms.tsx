import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — SocioHub" },
      { name: "description", content: "SocioHub Terms of Service and Privacy Policy." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-secondary/40">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Link>

        <header className="mb-8">
          <div className="inline-flex h-12 w-12 rounded-2xl bg-primary/10 text-primary items-center justify-center mb-4">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Master Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective: 1 January 2026 · Last updated: 13 May 2026</p>
        </header>

        <article className="prose prose-sm max-w-none space-y-6 text-foreground">
          <section>
            <h2 className="text-lg font-semibold">1. Acceptance of Terms</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              By creating an account on SocioHub ("Service") you agree to these Terms of Service and our Privacy Policy. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">2. Eligibility & Accounts</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You must be 18+ and a verified resident, owner, committee member, or authorised security personnel of a registered housing society to use member-facing features. You are responsible for keeping your credentials secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">3. Society Data & Roles</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Each Society Admin is responsible for the accuracy of society data, member roles, and communications posted from their society. SocioHub provides the platform; admins govern the content and community.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">4. Payments & Fees</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Maintenance and society dues collected via SocioHub are routed directly to your society's verified bank account. SocioHub charges a transparent platform fee of <strong>1.5% per transaction</strong>; the remaining <strong>98.5%</strong> is credited to the Society Fund. All fee breakdowns are visible inside the app on every payment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">5. Privacy</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We collect only the data needed to operate the Service: contact details, flat assignments, payment records, visitor logs, and community posts. We never sell personal data. Visitor logs and security footage are accessible only to authorised society staff. You may request deletion of your account by contacting your Society Admin.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">6. Acceptable Use</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You will not post unlawful, defamatory, harassing, or hateful content; impersonate other residents; circumvent security; or scrape society data. Society Admins may remove content that violates community guidelines.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">7. Limitation of Liability</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              SocioHub is provided on an "as-is" basis. We are not liable for disputes between residents, society committees, vendors, or third parties; for delays in payment settlement caused by banking partners; or for indirect damages.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">8. Changes</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We may update these Terms. Material changes will be announced in-app at least 14 days before they take effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">9. Contact</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Questions? Reach us via the Help section in the app, or write to your Society Admin.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
