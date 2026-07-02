import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund & Cancellation Policy — SocioHub" },
      { name: "description", content: "SocioHub refund and cancellation policy for society maintenance and subscription plans." },
      { property: "og:title", content: "Refund & Cancellation Policy — SocioHub" },
      { property: "og:description", content: "Refund eligibility, timelines and how to raise a request." },
    ],
  }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-10 space-y-6">
        <Link to="/legal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Legal Center
        </Link>

        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Refund & Cancellation Policy</h1>
            <p className="text-sm text-muted-foreground">Effective: 1 July 2026</p>
          </div>
        </header>

        <Card className="rounded-2xl"><CardContent className="p-6 space-y-6 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Society maintenance payments</h2>
            <p className="text-muted-foreground">
              <strong>Transactions processed for society maintenance are final.</strong> Refunds are only applicable in case
              of double-payment or technical failure. Requests must be submitted via{" "}
              <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a> within{" "}
              <strong>48 hours</strong> of the transaction. Valid refunds will be credited back to the original source within{" "}
              <strong>5–7 working days</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. What qualifies for a refund</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Duplicate payment for the same bill within a short window.</li>
              <li>Payment debited from your bank but bill still shows Unpaid after 24 hours.</li>
              <li>Technical failure attributable to SocioHub or the payment gateway.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. What does not qualify</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Dispute over the maintenance amount itself — raise this with your Society Admin.</li>
              <li>Change of mind after a successful payment.</li>
              <li>Late-payment penalties already applied by the society.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. SocioHub SaaS subscription plans</h2>
            <p className="text-muted-foreground">
              Subscription plans (Basic, Pro, Premium, custom) are billed in advance for the selected term. Cancellation
              stops future renewals but the current term is <strong>non-refundable</strong>. If you were charged in error or
              billed after cancellation, email the same address within 48 hours for a full refund.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. How to submit a refund request</h2>
            <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
              <li>Email <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a> from your registered email.</li>
              <li>Include the Razorpay Payment ID (starts with <code>pay_</code>) and a short description.</li>
              <li>Attach a screenshot of the bank debit or Razorpay receipt.</li>
              <li>You will receive an acknowledgement within 24 hours and a resolution within 5–7 working days.</li>
            </ol>
          </section>
        </CardContent></Card>
      </main>
      <LegalFooter />
    </div>
  );
}
