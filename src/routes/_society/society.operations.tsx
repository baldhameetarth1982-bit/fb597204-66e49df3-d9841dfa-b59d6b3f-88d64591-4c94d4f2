import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import { PurchasesTab } from "@/features/procurement/procurement";
import { StaffTab, VendorsTab, AssetsTab, InventoryTab } from "@/components/operations/OperationsTabs";

export const Route = createFileRoute("/_society/society/operations")({
  head: () => ({
    meta: [
      { title: "Operations — SociyoHub" },
      { name: "description", content: "Society staff, vendors and contracts, assets with service history, inventory and purchase requests." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OperationsPage,
});

const TABS = [["staff", "Staff"], ["vendors", "Vendors"], ["assets", "Assets"], ["inventory", "Inventory"], ["purchases", "Purchases"]] as const;
type Tab = (typeof TABS)[number][0];

function OperationsPage() {
  const [tab, setTab] = useState<Tab>("staff");
  return (
    <PageShell>
      <PageHeader title="Operations" description="Staff, vendors, assets and stock. Payments still go through Expenses." />
      <div role="tablist" aria-label="Operations sections" className="mb-4 grid grid-cols-3 gap-1 sm:grid-cols-5 rounded-2xl bg-muted p-1">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-xl text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "staff" && <StaffTab />}
      {tab === "vendors" && <VendorsTab />}
      {tab === "assets" && <AssetsTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "purchases" && <PurchasesTab />}
    </PageShell>
  );
}
