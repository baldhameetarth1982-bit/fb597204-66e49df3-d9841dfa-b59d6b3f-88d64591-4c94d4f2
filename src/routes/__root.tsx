import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/context/AuthContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shared/AppSidebar";
import { AppHeader } from "@/components/shared/AppHeader";
import { ResidentBottomNav } from "@/components/shared/ResidentBottomNav";
import { SocietyBottomNav } from "@/components/shared/SocietyBottomNav";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SocioHub" },
      { name: "description", content: "Society management, simplified." },
      { property: "og:title", content: "SocioHub" },
      { property: "og:description", content: "Society management, simplified." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "SocioHub" },
      { name: "twitter:description", content: "Society management, simplified." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f376b04d-5f89-44d0-8d56-1d48462c1cfe/id-preview-ad349b40--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app-1778372635197.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f376b04d-5f89-44d0-8d56-1d48462c1cfe/id-preview-ad349b40--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app-1778372635197.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/support", "/terms"];

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReferralCapture />
        <MarketingAnalytics />
        <ShellSwitcher />
        <Toaster richColors closeButton position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ReferralCapture() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) localStorage.setItem("sociohub:ref", ref);
  }, [pathname]);
  return null;
}

function MarketingAnalytics() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
    if (gaId && !(window as any).gtag) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(script);
      (window as any).dataLayer = (window as any).dataLayer || [];
      (window as any).gtag = function gtag(){ (window as any).dataLayer.push(arguments); };
      (window as any).gtag("js", new Date());
    }
    if (gaId && (window as any).gtag) (window as any).gtag("config", gaId, { page_path: pathname });

    const pixelId = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
    if (pixelId && !(window as any).fbq) {
      const fbq = function (...args: unknown[]) { ((fbq as any).queue = (fbq as any).queue || []).push(args); };
      (window as any).fbq = fbq;
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(script);
      (window as any).fbq("init", pixelId);
    }
    if (pixelId && (window as any).fbq) (window as any).fbq("track", "PageView");
  }, [pathname]);
  return null;
}

function ShellSwitcher() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Bare shell: auth pages
  if (AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return <Outlet />;
  }

  // Resident shell: native mobile app frame, fixed bottom nav
  if (pathname.startsWith("/app") || pathname.startsWith("/onboarding")) {
    return (
      <div className="min-h-screen w-full bg-secondary/40">
        <div className="relative mx-auto w-full max-w-[420px] min-h-screen bg-background shadow-xl flex flex-col">
          <AppHeader withSidebarTrigger={false} />
          <main className="flex-1 pb-24">
            <Outlet />
          </main>
          {pathname.startsWith("/app") && <ResidentBottomNav />}
        </div>
      </div>
    );
  }

  if (pathname.startsWith("/society")) {
    return (
      <SidebarProvider>
        <div className="min-h-screen w-full bg-secondary/40 md:bg-background">
          <div className="relative mx-auto flex min-h-screen w-full max-w-[420px] bg-background shadow-xl md:max-w-none md:shadow-none">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader />
              <main className="flex-1 pb-24 md:pb-0">
                <Outlet />
              </main>
              <SocietyBottomNav />
            </div>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  // Default admin shell: sidebar + header
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
