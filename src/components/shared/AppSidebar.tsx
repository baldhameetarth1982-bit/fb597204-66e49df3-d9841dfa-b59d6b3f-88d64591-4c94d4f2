import { useTranslation } from "react-i18next";
import { langDir } from "@/lib/i18n";
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
    label: "nav.overview",
    items: [
      { title: "nav.dashboard", url: "/society/dashboard", icon: LayoutDashboard },
      { title: "nav.search", url: "/society/search", icon: Search },
    ],
  },
  {
    label: "nav.group.money",
    items: [
      {
        title: "nav.billing", url: "/society/billing", icon: Receipt,
        match: ["/society/billing-settings", "/society/bill-studio", "/society/accounts", "/society/ledger", "/society/expenses", "/society/payouts", "/society/reports"],
      },
    ],
  },
  {
    label: "nav.group.people",
    items: [
      { title: "nav.residents", url: "/society/residents", icon: Users },
      { title: "nav.flats", url: "/society/flats", icon: DoorOpen },
      { title: "nav.blocks", url: "/society/blocks", icon: Building2 },
      { title: "nav.verifications", url: "/society/verifications", icon: BadgeCheck },
      { title: "nav.vehicles", url: "/society/vehicles", icon: Car },
      { title: "nav.visitors", url: "/society/visitors", icon: UserCheck },
    ],
  },
  {
    label: "nav.group.community",
    items: [
      { title: "nav.announcements", url: "/society/announcements", icon: Megaphone },
      { title: "nav.polls", url: "/society/polls", icon: Vote },
      { title: "nav.leaderboard", url: "/society/leaderboard", icon: Trophy },
      { title: "nav.aiDigest", url: "/society/digest", icon: Sparkles },
    ],
  },
  {
    label: "nav.group.administration",
    items: [
      { title: "nav.teamRoles", url: "/society/team", icon: ShieldCheck },
      { title: "nav.automations", url: "/society/automations", icon: Zap },
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
  const { t: tr, i18n: i18nInst } = useTranslation();

  return (
    <Sidebar side={langDir(i18nInst.language) === "rtl" ? "right" : "left"} collapsible="icon" className="border-sidebar-border bg-sidebar">
      <SidebarHeader className="h-16 justify-center border-b border-border px-4">
          <Link to="/" className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size={30} />
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight text-foreground">SociyoHub</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-3">
        {groups.map((g) => (
          <SidebarGroup key={tr(g.label)} className="py-1.5">
            {!collapsed && (
              <SidebarGroupLabel className="h-7 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {tr(g.label)}
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
                        tooltip={tr(item.title)}
                        className="relative h-11 rounded-md px-3 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-primary"
                      >
                        <Link to={item.url} aria-current={active ? "page" : undefined} className="flex items-center gap-3">
                          {active && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-primary" />}
                          <item.icon className="h-[18px] w-[18px] shrink-0" />
                          {!collapsed && <span className="text-sm">{tr(item.title)}</span>}
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
