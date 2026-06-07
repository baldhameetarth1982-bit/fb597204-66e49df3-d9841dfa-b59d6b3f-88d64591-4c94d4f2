import { Bell, LogOut, Settings, User } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
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

export function AppHeader({ withSidebarTrigger = true }: { withSidebarTrigger?: boolean } = {}) {
  const { user, profile, signOut, hasRole } = useAuth() as any;
  const navigate = useNavigate();
  const isSocietyAdmin = typeof hasRole === "function" && (hasRole("society_admin") || hasRole("super_admin"));
  const notificationsHref = isSocietyAdmin ? "/society/announcements" : "/app/notices";

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border bg-background">
      <div className="h-full flex items-center gap-2 px-3 md:px-6">
        {withSidebarTrigger && <SidebarTrigger className="rounded-xl h-10 w-10" />}

        <Link to="/" className="md:hidden flex items-center gap-2 ml-1">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-bold">
            S
          </div>
          <span className="font-semibold tracking-tight">SocioHub</span>
        </Link>

        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <ThemeToggle />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            asChild
            className="relative rounded-xl h-10 w-10 text-foreground hover:bg-secondary"
          >
            <Link to={notificationsHref as any}>
              <Bell className="h-5 w-5" />
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-10 w-10 ring-1 ring-border">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {initials(profile?.full_name, user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl">
              <DropdownMenuLabel className="flex flex-col">
                <span className="text-sm font-semibold truncate">
                  {profile?.full_name || "Account"}
                </span>
                <span className="text-xs text-muted-foreground font-normal truncate">
                  {user?.email ?? "Not signed in"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                <Link to="/settings">
                  <User className="h-4 w-4 mr-2" /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                <Link to="/settings">
                  <Settings className="h-4 w-4 mr-2" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="rounded-lg text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="h-4 w-4 mr-2" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
