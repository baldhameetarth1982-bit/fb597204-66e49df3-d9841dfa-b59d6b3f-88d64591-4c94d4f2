import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — SocioHub" },
      { name: "description", content: "How SocioHub collects, uses and protects your personal data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: June 2026</p>
        </div>
      </header>

      <Card className="rounded-2xl"><CardContent className="p-6 space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">1. What we collect</h2>
          <p>SocioHub is a housing-society management app maintained by the society administrators who deploy it. We collect:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
            <li>Account details — name, email, phone (for OTP), flat/block, role.</li>
            <li>Society activity — posts, comments, notices, polls, complaints, maintenance bills and payments.</li>
            <li>Optional KYC — last four digits of Aadhaar and uploaded document, only when you choose to verify.</li>
            <li>Device data — push-notification token, browser type, basic crash diagnostics.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">2. How we use it</h2>
          <p className="text-muted-foreground">Strictly to operate your society: showing notices, processing maintenance dues, managing visitors and vehicles, and sending alerts you opt in to. We do not sell personal data and do not run third-party advertising profiles against your account.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">3. Who can see what</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
            <li>Other residents see your name, flat and posts you publish.</li>
            <li>Society admins see contact details and payment history for billing.</li>
            <li>Phone number visibility to neighbours is opt-in (Settings → Privacy).</li>
            <li>Aadhaar documents are visible only to society admins for verification.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">4. Storage and security</h2>
          <p className="text-muted-foreground">Data is hosted on Lovable Cloud (Supabase) with row-level security policies, encrypted at rest, and transported over TLS. Access is scoped to your society.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">5. Your rights</h2>
          <p className="text-muted-foreground">You can edit your profile, opt out of marketing emails, hide your phone, and request full account deletion from Settings → More → Delete account. See our <Link to="/gdpr" className="underline">Data Retention &amp; Deletion Policy</Link> for details.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">6. Contact</h2>
          <p className="text-muted-foreground">Questions about this policy? Reach your society admin in-app, or email the SocioHub operator listed in your society profile.</p>
        </section>
      </CardContent></Card>
    </main>
  );
}
