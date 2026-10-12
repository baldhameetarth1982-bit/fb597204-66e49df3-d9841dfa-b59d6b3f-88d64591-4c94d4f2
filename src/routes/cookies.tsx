import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Cookie } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/shared/LegalFooter";
import { readConsent, saveConsent, type Consent } from "@/lib/cookie-consent";
import { BRAND } from "@/config/brand";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy — SociyoHub" },
      { name: "description", content: "Which cookies and browser storage SociyoHub uses, why, and how to change your choice." },
      { property: "og:title", content: "Cookie Policy — SociyoHub" },
      { property: "og:description", content: "Essential storage only by default; analytics and ads only with your permission." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://sociohub.live/cookies" },
    ],
    links: [{ rel: "canonical", href: "https://sociohub.live/cookies" }],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  const [choice, setChoice] = useState<Consent | null>(null);
  useEffect(() => setChoice(readConsent()), []);
  const set = (v: Consent) => { saveConsent(v); setChoice(v); };
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-10 space-y-6">
        <Link to="/legal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Legal Center
        </Link>
        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center"><Cookie className="h-5 w-5" aria-hidden /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cookie Policy</h1>
            <p className="text-sm text-muted-foreground">Effective: 12 October 2026</p>
          </div>
        </header>
        <Card className="rounded-2xl"><CardContent className="p-6 space-y-5 text-[15px] leading-relaxed">
          <section><h2 className="font-semibold">1. Essential storage (always on)</h2>
            <p>Your sign-in session, language, theme, accessibility choice, a referral code you arrived with, and this cookie choice are kept in your browser so the app works. These are needed for the service and do not need permission under the Digital Personal Data Protection Act, 2023.</p></section>
          <section><h2 className="font-semibold">2. Optional analytics and advertising</h2>
            <p>If enabled by SociyoHub, Google Analytics and Meta Pixel may measure visits to our public pages (home, pricing, about, contact and legal pages). They load only after you choose "Accept". They never run inside society, resident, guard or admin screens, so bills, visitors, complaints and personal details are never sent to them.</p></section>
          <section><h2 className="font-semibold">3. Your choice</h2>
            <p>Current choice: <strong>{choice === "accepted" ? "Accepted" : choice === "rejected" ? "Optional cookies rejected" : "Not chosen yet"}</strong>. Rejecting stops optional trackers from loading on your next page; any cookies they already set can be cleared from your browser settings.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => set("rejected")}>Reject optional cookies</Button>
              <Button className="min-h-11" onClick={() => set("accepted")}>Accept all cookies</Button>
            </div></section>
          <section><h2 className="font-semibold">4. Contact</h2>
            <p>Questions: <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>. See also our <Link to="/privacy" className="underline">Privacy Policy</Link>.</p></section>
        </CardContent></Card>
      </main>
      <LegalFooter />
    </div>
  );
}
