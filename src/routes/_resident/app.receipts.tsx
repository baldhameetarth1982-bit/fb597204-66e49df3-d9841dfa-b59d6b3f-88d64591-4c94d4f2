import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiptList } from "@/components/billing/ReceiptList";

export const Route = createFileRoute("/_resident/app/receipts")({
  head: () => ({
    meta: [
      { title: "My receipts — SociyoHub" },
      { name: "description", content: "Receipts for your verified maintenance payments." },
    ],
  }),
  component: ResidentReceiptsPage,
});

function ResidentReceiptsPage() {
  return (
    <div className="px-5 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm" className="rounded-lg -ml-2 min-h-11">
        <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-1" />Bills</Link>
      </Button>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My receipts</h1>
        <p className="text-sm text-muted-foreground">Issued after the committee verifies your payment.</p>
      </header>
      <ReceiptList showHome={false} />
    </div>
  );
}
