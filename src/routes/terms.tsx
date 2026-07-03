import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions — SocioHub" },
      { name: "description", content: "SocioHub Terms of Service governing use of the SaaS platform for housing societies." },
      { property: "og:title", content: "Terms & Conditions — SocioHub" },
      { property: "og:description", content: "Terms of Service for the SocioHub SaaS platform." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-10 space-y-6">
        <Link to="/legal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Legal Center
        </Link>

        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Terms & Conditions</h1>
            <p className="text-sm text-muted-foreground">Effective: 1 July 2026</p>
          </div>
        </header>

        <Card className="rounded-2xl">
          <CardContent className="p-6 space-y-6 text-[15px] leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold mb-2">1. Acceptance</h2>
              <p className="text-muted-foreground">
                By creating an account, you agree to these Terms and to our{" "}
                <Link to="/privacy" className="underline">Privacy Policy</Link> and{" "}
                <Link to="/refund" className="underline">Refund Policy</Link>. If you do not agree, do not use SocioHub.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">2. The SaaS model</h2>
              <p className="text-muted-foreground">
                SocioHub is a Software-as-a-Service platform that provides digital tools for housing-society
                management — resident directory, notices, complaints, visitor logs, and maintenance-billing collection.
                <strong> SocioHub is a platform provider, not the society administration itself.</strong> Each society's
                admin is responsible for the accuracy of member data, dues, and community content posted under their
                society.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">3. Eligibility & accounts</h2>
              <p className="text-muted-foreground">
                You must be 18+ and a genuine resident, owner, committee member, or authorised security personnel of
                a housing society. You are responsible for keeping your credentials secure and for all activity under
                your account.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">4. Maintenance payments</h2>
              <p className="text-muted-foreground">
                Maintenance dues collected via SocioHub are <strong>society dues</strong> owed by the resident to their
                housing society. SocioHub facilitates the collection through Razorpay and routes the funds directly to
                the society's verified bank account. SocioHub charges a transparent platform fee of{" "}
                <strong>1.5% per successful transaction</strong>; the remaining 98.5% is credited to the society. The
                fee breakdown is shown to the payer in a Transaction Summary before every payment.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">5. SaaS subscription fees</h2>
              <p className="text-muted-foreground">
                Society admins may subscribe to Basic, Pro, Premium, or custom plans. Plans are billed in advance for
                the chosen term. See our <Link to="/refund" className="underline">Refund Policy</Link> for
                cancellation and refund terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6. Acceptable use</h2>
              <p className="text-muted-foreground">
                You will not post unlawful, defamatory, harassing, or hateful content; impersonate other residents;
                circumvent security controls; or scrape society data. Society admins may remove content that violates
                community guidelines.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">7. Data & privacy</h2>
              <p className="text-muted-foreground">
                We collect only what's necessary for society management and never sell personal data. Full details in
                our <Link to="/privacy" className="underline">Privacy Policy</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">8. Limitation of liability</h2>
              <p className="text-muted-foreground">
                SocioHub is provided on an "as-is" basis. To the maximum extent permitted by law, SocioHub is not
                liable for disputes between residents or societies, delays caused by banking partners or the payment
                gateway, or any indirect, incidental, or consequential damages. Our aggregate liability is limited to
                the fees paid to SocioHub for the affected transaction.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">9. Termination</h2>
              <p className="text-muted-foreground">
                We may suspend or terminate accounts that violate these Terms. You may close your account at any time
                by writing to <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">10. Governing law</h2>
              <p className="text-muted-foreground">
                These Terms are governed by the laws of India. Any dispute is subject to the exclusive jurisdiction
                of the courts at Gandhinagar, Gujarat.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
              <p className="text-muted-foreground">
                Grievance Officer — SocioHub Support Team,{" "}
                <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>,
                Pethapur, Gandhinagar, Gujarat — 382610.
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
      <LegalFooter />
    </div>
  );
}
