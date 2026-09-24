import { createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
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
    <div className="pb-24">
      <MobileHero eyebrow="Billing centre" title="Receipts" subtitle="Issued only for verified Cash and Bank Transfer payments." icon={Receipt} variant="teal" />
      <div className="px-4 pt-4 space-y-4">
        <div className="rounded-2xl bg-card border shadow-sm"><BillingCenterTabs /></div>
        {loading ? (
          <div className="h-20 rounded-2xl bg-muted animate-pulse" aria-busy="true" />
        ) : societyId ? (
          <ReceiptList societyId={societyId} showHome />
        ) : (
          <p className="text-sm text-muted-foreground">No society is linked to your account.</p>
        )}
      </div>
    </div>
  );
}
