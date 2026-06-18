import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/gdpr")({
  head: () => ({
    meta: [
      { title: "Data Retention & Deletion — SocioHub" },
      { name: "description", content: "How long SocioHub keeps your data and how to request deletion or export." },
    ],
  }),
  component: GdprPage,
});

function GdprPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data Retention &amp; Deletion</h1>
          <p className="text-sm text-muted-foreground">GDPR / DPDP Act compliant policy</p>
        </div>
      </header>

      <Card className="rounded-2xl"><CardContent className="p-6 space-y-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">Retention periods</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
            <li><strong>Profile &amp; family records</strong> — kept while your account is active; removed within 30 days of deletion request.</li>
            <li><strong>Payments &amp; ledger entries</strong> — retained for 7 years to comply with financial-record laws, even after account deletion. Linked personal identifiers are anonymised.</li>
            <li><strong>Visitor logs</strong> — retained for 90 days, then purged.</li>
            <li><strong>KYC documents</strong> — deleted within 30 days of deletion request or when verification is revoked.</li>
            <li><strong>Push tokens &amp; session data</strong> — cleared on sign-out.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">How to delete your account</h2>
          <ol className="list-decimal pl-6 mt-2 space-y-1 text-muted-foreground">
            <li>Open <Link to="/settings" className="underline">Settings</Link> → More → Delete account.</li>
            <li>Type <code className="px-1 rounded bg-muted">DELETE</code> to confirm.</li>
            <li>Your profile, family members and KYC are queued for removal within 48 hours.</li>
            <li>You will receive an email confirmation when the deletion completes.</li>
          </ol>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">Data export</h2>
          <p className="text-muted-foreground">You can request a copy of all data we hold about you. Email your society admin or SocioHub support; we deliver a JSON export within 30 days at no cost.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">What deletion does not remove</h2>
          <p className="text-muted-foreground">For audit, legal and accounting reasons we retain (in anonymised form): aggregate payment totals, society-level financial reports and security event logs. No personal identifiers remain attached.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-2">Grievance officer</h2>
          <p className="text-muted-foreground">Under the DPDP Act, you may contact your society's designated grievance officer (listed in the society profile) for any privacy complaint.</p>
        </section>
      </CardContent></Card>
    </main>
  );
}
