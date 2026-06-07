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
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            className="relative rounded-xl h-10 w-10 text-primary hover:bg-secondary hover:text-primary"
          >
            <Bell className="h-5 w-5" />
            <span
              aria-hidden
              className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
            />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-10 w-10 ring-1 ring-border">
                  <AvatarFallback className="bg-secondary text-primary font-semibold">
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
              <DropdownMenuItem className="rounded-lg">
                <User className="h-4 w-4 mr-2" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg">
                <Settings className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="rounded-lg text-destructive focus:text-destructive"
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
