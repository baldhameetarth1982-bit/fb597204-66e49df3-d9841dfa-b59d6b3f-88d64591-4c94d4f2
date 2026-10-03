import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, Tags, CreditCard, Banknote, Megaphone, ReceiptText,
  Users, BarChart3, Settings, ShieldCheck, ScrollText, Search, Sparkles,
  TrendingUp, Heart, FileText, Palette,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";

const items = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Executive", url: "/admin/executive", icon: TrendingUp },
  { title: "BI Center", url: "/admin/bi", icon: BarChart3 },
  { title: "Health Scores", url: "/admin/health", icon: Heart },
  { title: "Report Builder", url: "/admin/report-builder", icon: FileText },
  { title: "Search", url: "/admin/search", icon: Search },
  { title: "Societies", url: "/admin/societies", icon: Building2 },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Plans", url: "/admin/plans", icon: Tags },
  { title: "Custom Plans", url: "/admin/custom-plans", icon: Sparkles },
  { title: "Revenue", url: "/admin/revenue", icon: BarChart3 },
  { title: "Income", url: "/admin/income", icon: BarChart3 },
  { title: "Ads", url: "/admin/ads", icon: Megaphone },
  { title: "Branding", url: "/admin/branding", icon: Palette },
  { title: "Razorpay", url: "/admin/razorpay", icon: CreditCard },
  { title: "Plan Payments", url: "/admin/subscription-payments", icon: ReceiptText },
  { title: "Withdrawals", url: "/admin/withdrawals", icon: Banknote },
  { title: "Audit", url: "/admin/audit", icon: ScrollText },
  { title: "Security", url: "/admin/security", icon: ShieldCheck },
  { title: "Revenue & Costs", url: "/admin/costs", icon: Banknote },
  { title: "AI Usage", url: "/admin/ai-usage", icon: Sparkles },
  { title: "Messaging", url: "/admin/messaging", icon: Megaphone },
  { title: "Assistant", url: "/admin/assistant", icon: Sparkles },
  { title: "Settings", url: "/admin/settings", icon: Settings },
] as const;

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-4">
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
                       className="relative h-11 rounded-md px-3 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-primary"
                    >
                       <Link to={item.url} aria-current={active ? "page" : undefined} className="flex items-center gap-3">
                         {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />}
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
