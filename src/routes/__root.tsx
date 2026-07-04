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
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shared/AppSidebar";
import { AdminSidebar } from "@/components/shared/AdminSidebar";
import { AppHeader } from "@/components/shared/AppHeader";

import { SocietyDrawer } from "@/components/shared/SocietyDrawer";
import { SocietyFab } from "@/components/shared/SocietyFab";
import { Toaster } from "@/components/ui/sonner";
import { SplashScreen } from "@/components/shared/SplashScreen";
import { RootErrorBoundary, installGlobalErrorLogger } from "@/components/shared/RootErrorBoundary";
import { ProtectedRoute } from "@/components/shared/AuthGuard";
import { LegalFooter } from "@/components/shared/LegalFooter";
import { PageTransition } from "@/components/system/PageTransition";


function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
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
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#1e3a8a" },
      { title: "SocioHub — Society management, simplified" },
      { name: "description", content: "Collect maintenance, share notices and manage your housing society — all in one beautiful app." },
      { property: "og:title", content: "SocioHub — Society management, simplified" },
      { property: "og:description", content: "Collect maintenance, share notices and manage your housing society — all in one beautiful app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "SocioHub" },
      { name: "twitter:description", content: "Society management, simplified." },
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

const AUTH_PATHS = ["/login", "/verify-phone", "/support", "/terms"];

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installGlobalErrorLogger();
  }, []);
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SplashScreen />
          <ThemeApplier />
          <ReferralCapture />
          <MarketingAnalytics />
          <ShellSwitcher />
          <Toaster richColors closeButton position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}


function ThemeApplier() {
  const { profile } = useAuth();
  useEffect(() => {
    const root = document.documentElement;
    const theme = (profile as any)?.theme;
    if (theme === "neon") root.classList.add("theme-neon");
    else root.classList.remove("theme-neon");
  }, [profile]);
  useEffect(() => {
    try {
      if (localStorage.getItem("sociohub:a11y") === "1") {
        document.documentElement.classList.add("a11y");
      }
    } catch {}
  }, []);
  return null;
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

function TransitionedOutlet() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Re-key on top-level path segment so transitions fire on section change
  // without thrashing on every param tweak.
  const seg = pathname.split("/").slice(0, 3).join("/") || "/";
  return (
    <PageTransition key={seg} className="contents">
      <Outlet />
    </PageTransition>
  );
}

function ShellSwitcher() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isProtectedPath = ["/app", "/society", "/admin", "/settings", "/onboarding"].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  ) || pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  // Bare shell: auth/redirect pages must not mount app layouts before routing settles.
  if (pathname === "/" || AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return <TransitionedOutlet />;
  }

  if (isProtectedPath) {
    return (
      <ProtectedRoute pathname={pathname}>
        <ProtectedShell pathname={pathname} />
      </ProtectedRoute>
    );
  }

  return <DefaultShell />;
}

function ProtectedShell({ pathname }: { pathname: string }) {
  // Resident shell: native mobile app frame, fixed bottom nav
  if (pathname.startsWith("/app") || pathname.startsWith("/onboarding")) {
    return (
      <div className="min-h-[100dvh] w-full bg-muted/40">
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background shadow-xl">
          <AppHeader withSidebarTrigger={false} />
          <main
            className="flex-1"
            style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}
          >
            <TransitionedOutlet />
          </main>
          {/* Bottom nav rendered by /_resident layout to avoid duplicate stacked bars */}
        </div>
      </div>
    );
  }

  if (pathname.startsWith("/society")) {
    return (
      <SidebarProvider>
        <div className="min-h-[100dvh] w-full bg-muted/40 md:bg-background">
          <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] bg-background shadow-xl md:max-w-none md:shadow-none">
            {/* Desktop sidebar only — hidden on mobile to make room for drawer */}
            <div className="hidden md:block">
              <AppSidebar />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader leading={<div className="md:hidden"><SocietyDrawer /></div>} />
              <main
                className="flex-1"
                style={{ paddingBottom: "calc(40px + env(safe-area-inset-bottom))" }}
              >
                <TransitionedOutlet />
              </main>
              <SocietyFab />
            </div>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  if (pathname.startsWith("/admin")) {
    return (
      <SidebarProvider>
        <div className="min-h-dvh flex w-full bg-background">
          <div className="hidden md:block">
            <AdminSidebar />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <AppHeader />
            <main className="flex-1">
              <TransitionedOutlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  // Default admin shell: sidebar + header
  return <DefaultShell />;
}

function DefaultShell() {
  return (
    <SidebarProvider>
      <div className="min-h-dvh flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main className="flex-1">
            <TransitionedOutlet />
          </main>
          <LegalFooter />
        </div>
      </div>
    </SidebarProvider>
  );
}
