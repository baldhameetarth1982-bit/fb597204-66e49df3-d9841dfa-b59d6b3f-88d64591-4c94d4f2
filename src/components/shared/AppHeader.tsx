import { useTranslation } from "react-i18next";
import { Bell, LogOut, Settings, User } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Logo } from "@/components/shared/Logo";
import { SociyoHubLogo } from "@/components/shared/SociyoHubLogo";

function initials(name?: string | null, email?: string | null) {
  const src = (name && name.trim()) || email || "U";
  return src
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const SECTION_LABEL_KEYS: Record<string, string> = {
  knowledge: "section.knowledge",
};

function sectionTitle(pathname: string, t: (k: string) => string) {
  const seg = pathname.split("/")[2];
  if (!seg) return null;
  if (SECTION_LABEL_KEYS[seg]) return t(SECTION_LABEL_KEYS[seg]);
  const navKey = `nav.${seg.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;
  const translated = t(navKey);
  if (translated !== navKey) return translated;
  const words = seg.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AppHeader({
  withSidebarTrigger = true,
  leading,
}: {
  withSidebarTrigger?: boolean;
  leading?: React.ReactNode;
} = {}) {
  const { user, profile, signOut, hasRole } = useAuth() as any;
  const navigate = useNavigate();
  const isSocietyAdmin = typeof hasRole === "function" && (hasRole("society_admin") || hasRole("super_admin"));
  const notificationsHref = isSocietyAdmin ? "/society/announcements" : "/app/notifications";
  const profileHref = isSocietyAdmin ? "/settings" : "/app/profile";
  const settingsHref = "/settings";

  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { t } = useTranslation();
  const section = sectionTitle(pathname, t);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="h-16 flex items-center gap-2 px-3 md:px-6">
        {leading}
        {withSidebarTrigger && <SidebarTrigger className="hidden md:inline-flex h-10 w-10 rounded-md" />}

        <Link to="/" className="md:hidden flex items-center gap-2 ms-1">
          <Logo size={32} />
          <SociyoHubLogo size={18} />
        </Link>

        {section && (
          <div className="hidden md:flex min-w-0 items-center gap-2 text-sm">
            <span className="h-4 w-px bg-border" aria-hidden />
            <span className="truncate font-semibold text-foreground">{section}</span>
          </div>
        )}

        <div className="ms-auto flex items-center gap-1 md:gap-2">
          <ThemeToggle />

          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.notifications")}
            asChild
            className="relative h-10 w-10 rounded-md text-foreground hover:bg-secondary"
          >
            <Link to={notificationsHref as any}>
              <Bell className="h-5 w-5" />
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("common.accountMenu")}
                className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-10 w-10 ring-1 ring-border">
                  <AvatarFallback className="bg-primary-container text-primary-container-foreground font-semibold">
                    {initials(profile?.full_name, user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-lg">
              <DropdownMenuLabel className="flex flex-col">
                <span className="text-sm font-semibold truncate">
                  {profile?.full_name || t("common.account")}
                </span>
                <span className="text-xs text-muted-foreground font-normal truncate">
                  {user?.email ?? t("common.notSignedIn")}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer rounded-md">
                <Link to={profileHref as any}>
                  <User className="h-4 w-4 me-2" /> {t("common.profile")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-md">
                <Link to={settingsHref as any}>
                  <Settings className="h-4 w-4 me-2" /> {t("common.settings")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer rounded-md text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4 me-2" /> {t("common.logOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
