import { useTranslation } from "react-i18next";
import { langDir } from "@/lib/i18n";
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

type Item = { title: string; url: string; icon: typeof Users };

/** SociyoHub control center, grouped by job (Admin Panel Guide modules). Every existing page is kept. */
const groups: { label: string; items: Item[] }[] = [
  { label: "Overview", items: [
    { title: "nav.dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
    { title: "nav.executive", url: "/admin/executive", icon: TrendingUp },
    { title: "nav.healthScores", url: "/admin/health", icon: Heart },
    { title: "nav.search", url: "/admin/search", icon: Search },
  ] },
  { label: "Societies & people", items: [
    { title: "nav.societies", url: "/admin/societies", icon: Building2 },
    { title: "nav.users", url: "/admin/users", icon: Users },
  ] },
  { label: "Plans & payments", items: [
    { title: "nav.plans", url: "/admin/plans", icon: Tags },
    { title: "nav.customPlans", url: "/admin/custom-plans", icon: Sparkles },
    { title: "nav.planPayments", url: "/admin/subscription-payments", icon: ReceiptText },
    { title: "nav.revenue", url: "/admin/revenue", icon: BarChart3 },
    { title: "nav.income", url: "/admin/income", icon: BarChart3 },
    { title: "nav.withdrawals", url: "/admin/withdrawals", icon: Banknote },
    { title: "nav.revenueCosts", url: "/admin/costs", icon: Banknote },
    { title: "nav.razorpay", url: "/admin/razorpay", icon: CreditCard },
  ] },
  { label: "Content & notifications", items: [
    { title: "nav.ads", url: "/admin/ads", icon: Megaphone },
    { title: "nav.marketplace", url: "/admin/marketplace", icon: Megaphone },
    { title: "nav.branding", url: "/admin/branding", icon: Palette },
    { title: "nav.messaging", url: "/admin/messaging", icon: Megaphone },
  ] },
  { label: "Reports", items: [
    { title: "nav.biCenter", url: "/admin/bi", icon: BarChart3 },
    { title: "nav.reportBuilder", url: "/admin/report-builder", icon: FileText },
    { title: "nav.aiUsage", url: "/admin/ai-usage", icon: Sparkles },
    { title: "nav.assistant", url: "/admin/assistant", icon: Sparkles },
  ] },
  { label: "Security & settings", items: [
    { title: "nav.security", url: "/admin/security", icon: ShieldCheck },
    { title: "nav.audit", url: "/admin/audit", icon: ScrollText },
    { title: "nav.settings", url: "/admin/settings", icon: Settings },
  ] },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t: tr, i18n: i18nInst } = useTranslation();

  return (
    <Sidebar side={langDir(i18nInst.language) === "rtl" ? "right" : "left"} collapsible="icon" className="border-sidebar-border bg-sidebar">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-4">
        <Link to="/admin/dashboard" className="flex items-center gap-2">
          <Logo size={36} />
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight text-foreground">
              {tr("nav.adminCenter")}
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-2">
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="py-1">
            {!collapsed && (
              <SidebarGroupLabel className="h-7 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.items.map((item) => {
                  const active = pathname === item.url || pathname.startsWith(item.url + "/");
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={tr(item.title)}
                        className="relative h-10 rounded-md px-3 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-primary"
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
