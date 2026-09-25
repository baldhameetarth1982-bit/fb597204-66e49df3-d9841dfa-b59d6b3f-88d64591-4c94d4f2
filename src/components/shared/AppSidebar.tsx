import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, DoorOpen, Users, Receipt, Megaphone,
  ShieldCheck, Vote, Sparkles, Car, UserCheck, Trophy,
  Search, Zap, BadgeCheck,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";

type Item = { title: string; url: string; icon: typeof Users; match?: readonly string[] };

/** Groups mirror the mobile bottom navigation so both layouts share one mental map. */
const groups: { label: string; items: Item[] }[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/society/dashboard", icon: LayoutDashboard },
      { title: "Search", url: "/society/search", icon: Search },
    ],
  },
  {
    label: "Money",
    items: [
      {
        title: "Billing", url: "/society/billing", icon: Receipt,
        match: ["/society/billing-settings", "/society/bill-studio", "/society/accounts", "/society/ledger", "/society/expenses", "/society/payouts", "/society/reports"],
      },
    ],
  },
  {
    label: "People & property",
    items: [
      { title: "Residents", url: "/society/residents", icon: Users },
      { title: "Flats", url: "/society/flats", icon: DoorOpen },
      { title: "Blocks", url: "/society/blocks", icon: Building2 },
      { title: "Verifications", url: "/society/verifications", icon: BadgeCheck },
      { title: "Vehicles", url: "/society/vehicles", icon: Car },
      { title: "Visitors", url: "/society/visitors", icon: UserCheck },
    ],
  },
  {
    label: "Community",
    items: [
      { title: "Announcements", url: "/society/announcements", icon: Megaphone },
      { title: "Polls", url: "/society/polls", icon: Vote },
      { title: "Leaderboard", url: "/society/leaderboard", icon: Trophy },
      { title: "AI Digest", url: "/society/digest", icon: Sparkles },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Team & Roles", url: "/society/team", icon: ShieldCheck },
      { title: "Automations", url: "/society/automations", icon: Zap },
    ],
  },
];

function isActive(pathname: string, item: Item) {
  return [item.url, ...(item.match ?? [])].some((u) => pathname === u || pathname.startsWith(u + "/"));
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="h-16 justify-center border-b border-border px-4">
        <Link to="/" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size={30} />
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight text-foreground">SociyoHub</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-3">
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="py-1.5">
            {!collapsed && (
              <SidebarGroupLabel className="h-7 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="relative h-10 rounded-lg px-3 text-muted-foreground hover:bg-secondary hover:text-foreground data-[active=true]:bg-primary-container data-[active=true]:font-semibold data-[active=true]:text-primary-container-foreground"
                      >
                        <Link to={item.url} aria-current={active ? "page" : undefined} className="flex items-center gap-3">
                          {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />}
                          <item.icon className="h-[18px] w-[18px] shrink-0" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
