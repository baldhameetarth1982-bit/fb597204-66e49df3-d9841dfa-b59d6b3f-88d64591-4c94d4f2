import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import { PurchasesTab } from "@/features/procurement/procurement";
import { MaintenanceScheduleTab } from "@/components/operations/MaintenanceScheduleTab";
import { HelpdeskReportsTab } from "@/components/operations/HelpdeskReportsTab";
import { StaffTab, VendorsTab, AssetsTab, InventoryTab } from "@/components/operations/OperationsTabs";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/operations")({
  head: () => ({
    meta: [
      { title: "Operations — SociyoHub" },
      { name: "description", content: "Society staff, vendors and contracts, assets with service history, inventory, purchase requests, vendor ratings and helpdesk reports." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OperationsPage,
});

const TABS = [["staff", "Staff"], ["vendors", "Vendors"], ["maintenance", "Maintenance"], ["assets", "Assets"], ["inventory", "Inventory"], ["purchases", "Purchases"], ["reports", "Reports"]] as const;
type Tab = (typeof TABS)[number][0];

function OperationsPage() {
  const [tab, setTab] = useState<Tab>("staff");
  return (
    <PageShell>
      <PageHeader title={tu("nav.operations")} description={tu("op.staff_vendors_assets_and_stock")} />
      <div role="tablist" aria-label={tu("op.operations_sections")} className="mb-4 grid grid-cols-3 gap-1 sm:grid-cols-7 rounded-2xl bg-muted p-1">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-xl text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "staff" && <StaffTab />}
      {tab === "vendors" && <VendorsTab />}
      {tab === "maintenance" && <MaintenanceScheduleTab />}
      {tab === "assets" && <AssetsTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "purchases" && <PurchasesTab />}
      {tab === "reports" && <HelpdeskReportsTab />}
    </PageShell>
  );
}
