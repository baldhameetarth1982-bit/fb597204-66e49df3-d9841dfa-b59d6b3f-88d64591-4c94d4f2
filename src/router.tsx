import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { SociyoHubLoader } from "@/components/system/SociyoHubLoader";

/** Auth/permission/validation failures never succeed on retry. */
function isNonRetryable(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return true;
  }
  // PostgREST permission / RLS / not-found style codes.
  if (e?.code && ["42501", "PGRST301", "PGRST116", "22P02"].includes(e.code)) return true;
  return false;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Dedupe remounts/navigation refetches; screens with live needs set their own staleTime.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => !isNonRetryable(error) && failureCount < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // Writes (bills, payments, approvals) must never be silently replayed.
        retry: false,
      },
    },
  });

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
