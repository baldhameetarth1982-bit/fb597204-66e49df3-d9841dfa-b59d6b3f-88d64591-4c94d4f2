import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — SocioHub" },
      { name: "description", content: "How SocioHub collects, uses and protects your personal data. We do not sell data to third parties." },
      { property: "og:title", content: "Privacy Policy — SocioHub" },
      { property: "og:description", content: "How SocioHub collects, uses and protects your personal data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-10 space-y-6">
        <Link to="/legal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Legal Center
        </Link>

        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Effective: 1 July 2026</p>
          </div>
        </header>

        <Card className="rounded-2xl">
          <CardContent className="p-6 space-y-6 text-[15px] leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold mb-2">1. Overview</h2>
              <p className="text-muted-foreground">
                SocioHub ("we", "us", "the Service") is a Software-as-a-Service platform operated for the purpose of
                housing-society management. This policy explains what personal information we collect, why we collect
                it, how we secure it, and the rights you have over it. SocioHub is <strong>not</strong> the society
                administration; each society controls its own community content within the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">2. Information we collect</h2>
              <p className="text-muted-foreground">We collect only the information strictly necessary for society management:</p>
              <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
                <li><strong>Identity:</strong> full name, flat/unit details, block, relationship (owner / tenant / family).</li>
                <li><strong>Contact:</strong> email address and phone number, used for authentication and notifications.</li>
                <li><strong>Optional KYC:</strong> last four digits of Aadhaar and a document image, only when you choose to verify.</li>
                <li><strong>Payment metadata:</strong> Razorpay payment/order IDs, amount, bill reference. We never store card numbers, CVV, or UPI PIN — those are handled directly by Razorpay under PCI-DSS compliance.</li>
                <li><strong>Community activity:</strong> posts, comments, complaints, poll votes and other content you publish inside your society.</li>
                <li><strong>Device data:</strong> push-notification token, browser/user-agent, basic crash and error diagnostics.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">3. How we use it</h2>
              <p className="text-muted-foreground">
                Strictly to operate your society: showing notices, processing maintenance dues, managing visitors and
                vehicles, sending alerts you opt in to, and preventing abuse. <strong>We do not sell personal data to
                third parties</strong> and we do not run third-party advertising profiles against your account.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">4. Data security</h2>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>All traffic between your device and our servers is encrypted over TLS (HTTPS with 128-bit SSL or higher).</li>
                <li>Data at rest is encrypted on managed Postgres storage.</li>
                <li>Row-level security policies scope every query to your society; residents of one society cannot access another society's data.</li>
                <li>Card and UPI data never touches our servers — Razorpay processes and stores it under PCI-DSS.</li>
                <li>Aadhaar images live in a private storage bucket accessible only to authorised society admins for verification.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">5. Who can see what</h2>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>Other residents in your society see your name, flat, and posts you publish.</li>
                <li>Your society admin sees contact details and payment history for billing purposes.</li>
                <li>Phone visibility to neighbours is opt-in from Settings.</li>
                <li>SocioHub staff access production data only for support requests you initiate.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6. Data retention</h2>
              <p className="text-muted-foreground">
                Account data is retained while your society is active. On account deletion, personal identifiers are
                removed within 30 days; anonymised financial records may be kept for statutory audit periods (up to 7
                years) as required by Indian tax and accounting law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">7. Your rights</h2>
              <p className="text-muted-foreground">
                You can access and correct your data from the app, opt out of marketing emails, hide your phone number
                from neighbours, and request full account deletion by writing to{" "}
                <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">8. Grievance contact</h2>
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
