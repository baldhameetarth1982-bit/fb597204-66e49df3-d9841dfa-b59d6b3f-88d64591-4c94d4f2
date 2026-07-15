import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { SociyoHubLoader } from "@/components/system/SociyoHubLoader";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: () => (
      <div className="min-h-[50dvh] grid place-items-center p-6">
        <SociyoHubLoader />
      </div>
    ),
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  });

  return router;
};
