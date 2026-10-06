import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { ReceiptList } from "@/components/billing/ReceiptList";
import { tu } from "@/lib/i18n";

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
      <PageHeader title={tu("billingTabs.receipts")} description={tu("op.issued_only_for_confirmed_payments")} />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>
      {loading ? (
        <div className="h-20 rounded-2xl bg-muted animate-pulse" aria-busy="true" aria-label={tu("op.loading")} />
      ) : societyId ? (
        <ReceiptList societyId={societyId} showHome />
      ) : (
        <p className="text-sm text-muted-foreground">{tu("op.no_society_is_linked_to")}</p>
      )}
    </PageShell>
  );
}
