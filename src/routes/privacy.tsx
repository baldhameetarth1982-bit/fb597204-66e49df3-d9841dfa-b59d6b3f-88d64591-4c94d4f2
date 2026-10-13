import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — SociyoHub" },
      { name: "description", content: "How SociyoHub collects, uses and protects your personal data. We do not sell data to third parties." },
      { property: "og:title", content: "Privacy Policy — SociyoHub" },
      { property: "og:description", content: "How SociyoHub collects, uses and protects your personal data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://sociohub.live/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
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
            <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Effective: 1 July 2026</p>
          </div>
        </header>

        <Card className="rounded-2xl">
          <CardContent className="p-6 space-y-6 text-[15px] leading-relaxed sm:p-6">
            <section>
              <h2 className="text-lg font-semibold mb-2">1. Overview</h2>
              <p className="text-muted-foreground">
                SociyoHub ("we", "us", "the Service") is a Software-as-a-Service platform operated for the purpose of
                housing-society management. This policy explains what personal information we collect, why we collect
                it, how we secure it, and the rights you have over it. SociyoHub is <strong>not</strong> the society
                administration; each society controls its own community content within the platform.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">2. Information we collect</h2>
              <p className="text-muted-foreground">We collect only the information strictly necessary for society management:</p>
              <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
                <li><strong>Identity:</strong> full name, flat/unit details, block, relationship (owner / tenant / family).</li>
                <li><strong>Contact:</strong> email address and phone number, used for authentication and notifications. Phone numbers are confirmed by a message you send from your own phone (SMS or WhatsApp) through our phone-verification provider, ReverseOTP.</li>
                <li><strong>Year of birth:</strong> asked once when you create your account, only to confirm you are 18 or older. We do not ask for your full date of birth.</li>
                <li><strong>Guard work details:</strong> for security guards, the society code you joined with, your join request, the weekdays and hours your committee sets for your shifts, and gate activity during those shifts.</li>
                <li><strong>Optional KYC:</strong> last four digits of Aadhaar and a document image, only when you choose to verify.</li>
                <li><strong>Payment metadata:</strong> payment/order reference IDs, amount, bill reference. We never see or store card numbers, CVV or UPI PINs. Maintenance is paid by cash, bank transfer or UPI directly to your society; you may upload a payment screenshot and reference number for verification.</li>
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
                <li>Card and UPI PIN data never reaches our servers; UPI payments happen inside your own UPI app.</li>
                <li>Aadhaar images live in a private storage bucket accessible only to authorised society admins for verification.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">5. Who can see what</h2>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>Other residents in your society see your name, flat, and posts you publish.</li>
                <li>Your society admin sees contact details and payment history for billing purposes.</li>
                <li>Other residents cannot see your phone number or email address.</li>
                <li>SociyoHub staff access production data only for support requests you initiate.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">5A. Where your data goes (service providers)</h2>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li><strong>Lovable Cloud (database, file storage and app hosting, built on Supabase and Cloudflare):</strong> stores all society data and files and runs the app.</li>
                <li><strong>Google Firebase:</strong> phone OTP and Google sign-in, and push notifications to your device.</li>
                <li><strong>Google Gemini and OpenAI (through Lovable AI):</strong> only when an AI feature is used, such as the AI Secretary, invoice reading, or reading an uploaded Aadhaar image for optional verification; they receive only the question, document or image needed for that task.</li>
                <li><strong>Razorpay:</strong> only if a society pays its SociyoHub subscription online once that option is switched on; it receives payment details, never resident data.</li>
              </ul>
              <p className="text-muted-foreground mt-2">Some of these providers may process data outside India under their own security commitments. We do not use advertising or analytics trackers inside society screens.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6. Data retention</h2>
              <p className="text-muted-foreground">
                Account data is retained while your society is active. When you delete your account from Settings, your login, contact details, family list, posts and personal
                files are removed immediately; anonymised financial records may be kept for statutory audit periods (up to 7
                years) as required by Indian tax and accounting law.
              </p>
              <p className="text-muted-foreground mt-2">
                <strong>UPI plan payments.</strong> When you pay a plan by UPI we collect the payer name, optional payer
                UPI ID, transaction ID, payment time and a screenshot, only to verify the payment and issue a GST receipt
                (purpose limitation under the Digital Personal Data Protection Act, 2023). Screenshots are stored in
                private storage, are visible only to SociyoHub's Super Admin through short-lived links, and are kept as
                payment records for the statutory period. Please crop out unrelated balances or messages before uploading.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6A. Why we may use your data (legal basis)</h2>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li><strong>Your consent</strong>, given when you sign up, join a society or opt in to optional messages. You can withdraw it at any time, and withdrawing is as easy as giving it.</li>
                <li><strong>Legitimate uses</strong> allowed by the Digital Personal Data Protection Act, 2023: data you share for a purpose you asked for (such as a visitor entry), meeting legal duties (such as GST and accounting records), and responding to emergencies or threats to safety.</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                If you withdraw consent, we stop processing for that purpose. Records the law requires us to keep are still kept, as explained in Data retention.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6B. Children</h2>
              <p className="text-muted-foreground">
                Accounts are for adults aged 18 and above. Society records may list children as family members only when an adult resident adds them. We do not track children's behaviour, show them targeted ads or profile them.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">6C. Data breaches</h2>
              <p className="text-muted-foreground">
                If a personal data breach happens, we will tell affected users without delay. We will explain what happened, the likely impact and the steps you can take. We will also report it to the Data Protection Board of India as the law requires.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">7. Your rights</h2>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li><strong>Access:</strong> you can see a summary of your data, how it is used and who it is shared with.</li>
                <li><strong>Correction:</strong> you can update your details in the app, or ask us to fix anything wrong or incomplete.</li>
                <li><strong>Deletion:</strong> you can delete your account from Settings, subject to the legal retention described above.</li>
                <li><strong>Withdraw consent and opt out</strong> of optional messages at any time from Settings.</li>
                <li><strong>Nominate</strong> a person to use these rights for you in case of death or incapacity.</li>
                <li><strong>Grievance redressal:</strong> contact us first. If you are not satisfied with our reply, you can complain to the Data Protection Board of India.</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                To use any of these rights, write to{" "}
                <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">8. Grievance contact</h2>
              <p className="text-muted-foreground">
                Grievance Officer — SociyoHub Support Team,{" "}
                <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>,
                Pethapur, Gandhinagar, Gujarat — 382610. We aim to resolve grievances within the time the law allows.
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
      <LegalFooter />
    </div>
  );
}
