import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  DoorOpen,
  Users,
  Receipt,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/society/dashboard", icon: LayoutDashboard },
  { title: "Blocks", url: "/society/blocks", icon: Building2 },
  { title: "Flats", url: "/society/flats", icon: DoorOpen },
  { title: "Residents", url: "/society/residents", icon: Users },
  { title: "Billing", url: "/society/billing", icon: Receipt },
  { title: "Team & Roles", url: "/society/team", icon: ShieldCheck },
  { title: "Announcements", url: "/society/announcements", icon: Megaphone },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="px-4 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center font-bold">
            S
          </div>
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
                      <a href={item.url} className="flex items-center gap-3">
                        <item.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && (
                          <span className="text-sm font-medium">{item.title}</span>
                        )}
                      </a>
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
