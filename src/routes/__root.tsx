import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shared/AppSidebar";
import { AdminSidebar } from "@/components/shared/AdminSidebar";
import { AppHeader } from "@/components/shared/AppHeader";

import { SocietyFab } from "@/components/shared/SocietyFab";
import { KeyboardFieldVisibility } from "@/components/system/KeyboardFieldVisibility";
import { ResidentBottomNav } from "@/components/nav/ResidentBottomNav";
import { SocietyAdminBottomNav } from "@/components/nav/SocietyAdminBottomNav";
import { GuardBottomNav } from "@/components/nav/GuardBottomNav";
import { SuperAdminBottomNav } from "@/components/nav/SuperAdminBottomNav";

import { Toaster } from "@/components/ui/sonner";
import { OfflineBanner } from "@/components/system/OfflineBanner";
import { MaintenanceScreen, MaintenanceStrip, useAppStatus } from "@/components/system/MaintenanceNotice";
import { usePlatformRoles } from "@/hooks/usePlatformRoles";
import { AskTextDialogHost } from "@/components/system/AskTextDialog";
import { SplashScreen } from "@/components/shared/SplashScreen";
import { RootErrorBoundary, installGlobalErrorLogger } from "@/components/shared/RootErrorBoundary";
import { ProtectedRoute } from "@/components/shared/AuthGuard";
import { PageTransition } from "@/components/system/PageTransition";
import { useTranslation } from "react-i18next";
import { applyStoredLanguage } from "@/lib/i18n";
import { installToastGuard } from "@/lib/toast-guard";

installToastGuard();


function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("shell.notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("shell.notFound.body")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {offline ? t("shell.offline.title") : t("shell.error.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {offline ? t("shell.offline.body") : t("shell.error.body")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

/** Applies the user's saved language after hydration (keeps SSR markup in English). */
function LanguageSync() {
  useEffect(() => {
    applyStoredLanguage();
  }, []);
  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { name: "theme-color", content: "#123047" },
      { title: "SociyoHub — Society management, simplified" },
      { name: "description", content: "Collect maintenance, share notices and manage your housing society — all in one beautiful app." },
      { property: "og:title", content: "SociyoHub — Society management, simplified" },
      { property: "og:description", content: "Collect maintenance, share notices and manage your housing society — all in one beautiful app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "SociyoHub" },
      { name: "twitter:description", content: "Society management, simplified." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
    // Apply the saved dark mode before first paint so sign-in and public pages never flash light.
    scripts: [{ children: "try{if(localStorage.getItem('sociohub:theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}" }],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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

const AUTH_PATHS = ["/login", "/reset-password", "/verify-phone", "/support", "/terms", "/welcome"];

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installGlobalErrorLogger();
    // Offline page for navigations (static, data-free). Same worker as push.
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => {});
    }
  }, []);
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountDataBoundary />
          <SplashScreen />
          <ThemeApplier />
          <LanguageSync />
          <ReferralCapture />
          <MarketingAnalytics />
          <ShellSwitcher />
          <Toaster richColors closeButton position="top-right" />
          <AskTextDialogHost />
          <OfflineBanner />
          <KeyboardFieldVisibility />
        </AuthProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}

function AccountDataBoundary() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  // Scope = account + active society. Any change wipes cached tenant data so
  // a previous society's records can never render after switching.
  useEffect(() => {
    const nextUserId = user ? `${user.id}:${profile?.society_id ?? ""}` : null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    previousUserId.current = nextUserId;
  }, [queryClient, user, profile?.society_id]);

  return null;
}


function ThemeApplier() {
  const { profile } = useAuth();
  useEffect(() => {
    const root = document.documentElement;
    const theme = (profile as any)?.theme;
    // "neon" was retired; anyone who had it now gets the premium Mayur theme.
    root.classList.remove("theme-neon");
    if (theme === "royal" || theme === "neon") root.classList.add("theme-royal");
    else root.classList.remove("theme-royal");
  }, [profile]);
  useEffect(() => {
    try {
      // Light/dark choice is per device and applies on every page, including sign-in.
      if (localStorage.getItem("sociohub:theme") === "dark") document.documentElement.classList.add("dark");
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
  // Pages read fixed text through tu(); re-mounting on a language change keeps them current.
  const { i18n: i18nInstance } = useTranslation();
  return (
    <PageTransition key={`${seg}|${i18nInstance.language}`} className="contents">
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
        <MaintenanceGate>
          <ProtectedShell pathname={pathname} />
        </MaintenanceGate>
      </ProtectedRoute>
    );
  }

  return <DefaultShell />;
}

/** While maintenance mode is on, only Super Admin and platform staff can use signed-in pages. */
function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const status = useAppStatus();
  const { isSuper, isStaff, isLoading } = usePlatformRoles();
  if (!status.data?.maintenance) return <>{children}</>;
  if (isLoading) return null;
  if (!isSuper && !isStaff) return <MaintenanceScreen message={status.data.message} />;
  return (
    <>
      <MaintenanceStrip />
      {children}
    </>
  );
}

function ProtectedShell({ pathname }: { pathname: string }) {
  const { primaryRole } = useAuth();
  const isGuard = pathname.startsWith("/app/guard");
  const isGuardSettings = primaryRole === "security" && pathname === "/settings";
  const isOnboarding = pathname.startsWith("/onboarding");
  const isPlanBlocker =
    pathname.endsWith("/plan-required") ||
    pathname === "/app/plan-required" ||
    pathname === "/society/plan-required";

  // Guard shell: minimal 3-tab mobile app.
  if (isGuard || isGuardSettings) {
    return (
      <div className="min-h-[100dvh] w-full bg-muted/40">
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background shadow-xl md:shadow-none">
          <AppHeader withSidebarTrigger={false} />
          <main
            className="flex-1"
            style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}
          >
            <TransitionedOutlet />
          </main>
          <GuardBottomNav />
        </div>
      </div>
    );
  }

  // Onboarding shell: no bottom nav.
  if (isOnboarding) {
    return (
      <div className="min-h-[100dvh] w-full bg-muted/40">
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background shadow-xl md:shadow-none">
          <AppHeader withSidebarTrigger={false} />
          <main className="flex-1">
            <TransitionedOutlet />
          </main>
        </div>
      </div>
    );
  }

  // Resident shell.
  if (pathname.startsWith("/app")) {
    return (
      <div className="min-h-[100dvh] w-full bg-muted/40">
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background shadow-xl md:shadow-none">
          <AppHeader withSidebarTrigger={false} />
          <main
            className="flex-1"
            style={{ paddingBottom: isPlanBlocker ? undefined : "calc(96px + env(safe-area-inset-bottom))" }}
          >
            <TransitionedOutlet />
          </main>
          {!isPlanBlocker && <ResidentBottomNav />}
        </div>
      </div>
    );
  }

  // Society Admin shell: sidebar on md+, mobile bottom nav below md.
  if (pathname.startsWith("/society")) {
    return (
      <SidebarProvider>
        <div className="min-h-[100dvh] w-full bg-background">
          <div className="relative mx-auto flex min-h-[100dvh] w-full bg-background md:max-w-none">
            <div className="hidden md:block">
              <AppSidebar />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader />
              <main
                className="flex-1"
                style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}
              >
                <TransitionedOutlet />
              </main>
              <SocietyFab />
            </div>
          </div>
          {!isPlanBlocker && <SocietyAdminBottomNav />}
        </div>
      </SidebarProvider>
    );
  }

  // Super Admin shell: sidebar on md+, mobile bottom nav below md.
  if (pathname.startsWith("/admin")) {
    return (
      <SidebarProvider>
        <div className="min-h-dvh flex w-full bg-background">
          <div className="hidden md:block">
            <AdminSidebar />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <AppHeader />
            <main
              className="flex-1"
              style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}
            >
              <TransitionedOutlet />
            </main>
          </div>
          <SuperAdminBottomNav />
        </div>
      </SidebarProvider>
    );
  }

  // Default (settings, misc protected pages).
  return <DefaultShell />;
}

/**
 * Shared pages (settings, legal, pricing, support) pick the chrome of the
 * signed-in person's own role, so a resident or guard never sees committee
 * navigation. Visitors who are not signed in get no app navigation at all.
 * Authorization still happens on the server for every page and action.
 */
function DefaultShell() {
  const { isAuthenticated, primaryRole } = useAuth();

  if (!isAuthenticated || !primaryRole) {
    return (
      <div className="min-h-dvh w-full bg-background">
        <TransitionedOutlet />
      </div>
    );
  }

  if (primaryRole === "resident" || primaryRole === "security") {
    const isGuard = primaryRole === "security";
    return (
      <div className="min-h-[100dvh] w-full bg-muted/40">
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background shadow-xl md:shadow-none">
          <AppHeader withSidebarTrigger={false} />
          <main className="flex-1" style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}>
            <TransitionedOutlet />
          </main>
          {isGuard ? <GuardBottomNav /> : <ResidentBottomNav />}
        </div>
      </div>
    );
  }

  const isSuper = primaryRole === "super_admin";
  const isCommittee = primaryRole === "society_admin" || primaryRole === "block_admin";
  return (
    <SidebarProvider>
      <div className="min-h-dvh flex w-full bg-background">
        {isSuper ? (
          <div className="hidden md:block"><AdminSidebar /></div>
        ) : isCommittee ? (
          <div className="hidden md:block"><AppSidebar /></div>
        ) : null}
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader withSidebarTrigger={isSuper || isCommittee} />
          <main className="flex-1" style={{ paddingBottom: "calc(96px + env(safe-area-inset-bottom))" }}>
            <TransitionedOutlet />
          </main>
        </div>
        {isSuper ? <SuperAdminBottomNav /> : isCommittee ? <SocietyAdminBottomNav /> : null}
      </div>
    </SidebarProvider>
  );
}
