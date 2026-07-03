import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneCall, ArrowLeft, Mail, MapPin, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact & Grievance — SocioHub" },
      { name: "description", content: "Contact the SocioHub Grievance Officer. Response within 48 business hours." },
      { property: "og:title", content: "Contact & Grievance — SocioHub" },
      { property: "og:description", content: "Grievance Officer contact for SocioHub SaaS platform." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-10 space-y-6">
        <Link to="/legal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Legal Center
        </Link>

        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contact & Grievance</h1>
            <p className="text-sm text-muted-foreground">We respond to every request within 48 business hours.</p>
          </div>
        </header>

        <Card className="rounded-2xl">
          <CardContent className="p-6 space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Grievance Officer</p>
              <p className="text-lg font-semibold mt-1">SocioHub Support Team</p>
            </div>

            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Email</p>
                  <a href="mailto:sociohub710@gmail.com" className="text-muted-foreground underline">
                    sociohub710@gmail.com
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Registered Address</p>
                  <p className="text-muted-foreground">
                    Pethapur, Gandhinagar, Gujarat — 382610, India
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Response Time</p>
                  <p className="text-muted-foreground">
                    Acknowledgement within 24 hours · Resolution within 48 business hours for most grievances,
                    and up to 5–7 working days for refund-related requests.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground leading-relaxed">
            <p>
              For payment disputes, please include your Razorpay Payment ID (starts with <code>pay_</code>) and a
              screenshot of the debit. For account or data-privacy requests, email us from your registered account.
            </p>
            <p className="mt-2">
              You may also review our{" "}
              <Link to="/refund" className="underline">Refund Policy</Link>,{" "}
              <Link to="/privacy" className="underline">Privacy Policy</Link>, and{" "}
              <Link to="/terms" className="underline">Terms</Link>.
            </p>
          </CardContent>
        </Card>
      </main>
      <LegalFooter />
    </div>
  );
}
