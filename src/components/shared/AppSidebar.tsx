import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, DoorOpen, Users, Receipt, Megaphone,
  ShieldCheck, Vote, Calculator, Sparkles, Car, UserCheck, Trophy, Wallet,
  Wand2, Search, Zap,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";

const items = [
  { title: "Dashboard", url: "/society/dashboard", icon: LayoutDashboard },
  { title: "Search", url: "/society/search", icon: Search },
  { title: "Blocks", url: "/society/blocks", icon: Building2 },
  { title: "Flats", url: "/society/flats", icon: DoorOpen },
  { title: "Residents", url: "/society/residents", icon: Users },
  { title: "Bill Studio", url: "/society/bill-studio", icon: Wand2 },
  { title: "Billing", url: "/society/billing", icon: Receipt },
  { title: "Expenses", url: "/society/expenses", icon: Wallet },
  { title: "Ledger", url: "/society/ledger", icon: Calculator },
  { title: "Vehicles", url: "/society/vehicles", icon: Car },
  { title: "Visitors", url: "/society/visitors", icon: UserCheck },
  { title: "Announcements", url: "/society/announcements", icon: Megaphone },
  { title: "Polls", url: "/society/polls", icon: Vote },
  { title: "Leaderboard", url: "/society/leaderboard", icon: Trophy },
  { title: "AI Digest", url: "/society/digest", icon: Sparkles },
  { title: "Team & Roles", url: "/society/team", icon: ShieldCheck },
  { title: "Verifications", url: "/society/verifications", icon: ShieldCheck },
  { title: "Automations", url: "/society/automations", icon: Zap },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="px-4 py-5">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={36} />
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight text-foreground">
              SocioHub
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-muted-foreground/80 text-xs uppercase tracking-wider">
              Modules
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => {
                const active =
                  pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="rounded-xl h-11 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground hover:bg-secondary"
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && (
                          <span className="text-sm font-medium">{item.title}</span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
