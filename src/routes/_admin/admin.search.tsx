import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

export const Route = createFileRoute("/_admin/admin/search")({
  head: () => ({ meta: [{ title: "Platform Search — Super Admin" }] }),
  component: AdminSearchPage,
});

function AdminSearchPage() {
  return (
    <div className="px-6 py-8 space-y-6 max-w-4xl">
      <header className="flex items-center gap-3">
        <Search className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Platform Search</h1>
          <p className="text-sm text-muted-foreground">Search across societies, residents, bills, visitors and posts.</p>
        </div>
      </header>
      <GlobalSearch />
    </div>
  );
}
