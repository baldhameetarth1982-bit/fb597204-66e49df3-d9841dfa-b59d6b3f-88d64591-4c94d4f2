import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { ReceiptList } from "@/components/billing/ReceiptList";

export const Route = createFileRoute("/_society/society/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts — SociyoHub" },
      { name: "description", content: "Receipts issued for verified society payments." },
    ],
  }),
  component: SocietyReceiptsPage,
});

function SocietyReceiptsPage() {
  const { societyId, loading } = useSocietyId();
  return (
    <PageShell>
      <PageHeader title="Receipts" description="Issued only for verified Cash and Bank Transfer payments. Voided receipts stay listed for the record." />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>
      {loading ? (
        <div className="h-20 rounded-2xl bg-muted animate-pulse" aria-busy="true" aria-label="Loading" />
      ) : societyId ? (
        <ReceiptList societyId={societyId} showHome />
      ) : (
        <p className="text-sm text-muted-foreground">No society is linked to your account.</p>
      )}
    </PageShell>
  );
}
