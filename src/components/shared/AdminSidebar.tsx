import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, Tags, CreditCard, Banknote, Megaphone,
  Users, BarChart3, Settings, ShieldCheck, ScrollText, Search, Sparkles,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";

const items = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Search", url: "/admin/search", icon: Search },
  { title: "Societies", url: "/admin/societies", icon: Building2 },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Plans", url: "/admin/plans", icon: Tags },
  { title: "Custom Plans", url: "/admin/custom-plans", icon: Sparkles },
  { title: "Revenue", url: "/admin/revenue", icon: BarChart3 },
  { title: "Income", url: "/admin/income", icon: BarChart3 },
  { title: "Ads", url: "/admin/ads", icon: Megaphone },
  { title: "Razorpay", url: "/admin/razorpay", icon: CreditCard },
  { title: "Withdrawals", url: "/admin/withdrawals", icon: Banknote },
  { title: "Audit", url: "/admin/audit", icon: ScrollText },
  { title: "Security", url: "/admin/security", icon: ShieldCheck },
  { title: "Settings", url: "/admin/settings", icon: Settings },
] as const;

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="px-4 py-5">
        <Link to="/admin/dashboard" className="flex items-center gap-2">
          <Logo size={36} />
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Admin Center
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-muted-foreground/80 text-xs uppercase tracking-wider">
              Platform
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
