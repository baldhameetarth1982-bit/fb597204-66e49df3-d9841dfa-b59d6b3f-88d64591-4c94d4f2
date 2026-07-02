import { Outlet, createFileRoute } from "@tanstack/react-router";
import { LegalFooter } from "@/components/shared/LegalFooter";

/** Public auth layout — login, register, password reset. Legal footer on every screen. */
export const Route = createFileRoute("/_auth")({
  component: () => (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1">
        <Outlet />
      </div>
      <LegalFooter compact />
    </div>
  ),
});
