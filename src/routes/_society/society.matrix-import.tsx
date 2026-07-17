// Stage 2E — retired. This route is a legacy duplicate import surface.
// The canonical bulk import route is `/society/import`. Anyone landing
// here is redirected. Direct navigation from other screens has been
// removed; this file remains so pre-existing bookmarks resolve.
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_society/society/matrix-import")({
  head: () => ({
    meta: [
      { title: "Bulk Import — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RetiredMatrixImportRedirect,
});

function RetiredMatrixImportRedirect() {
  return <Navigate to="/society/import" replace />;
}
