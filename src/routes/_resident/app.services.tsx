import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Shield,
  Car,
  AlertCircle,
  Sparkles,
  Wrench,
  PackageSearch,
  ChevronRight,
  Users,
  ScanLine,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_resident/app/services")({
  head: () => ({ meta: [{ title: "Services — SocioHub" }] }),
  component: ServicesScreen,
});

function ServicesScreen() {
  const { roles } = useAuth();
  const isGuard =
    roles.includes("security" as never) ||
    roles.includes("society_admin" as never) ||
    roles.includes("block_admin" as never);

  const primary = [
    { to: "/app/visitors", title: "My Visitors", desc: "See who came to your flat", icon: Users, accent: "bg-primary/10 text-primary" },
    { to: "/app/vehicles", title: "Vehicles", desc: "Register cars & two-wheelers", icon: Car, accent: "bg-primary/10 text-primary" },
    { to: "/app/helpdesk", title: "Complaints", desc: "Raise & track society issues", icon: AlertCircle, accent: "bg-destructive/10 text-destructive" },
  ] as const;

  const more = [
    { title: "Daily Help",   icon: Sparkles,      cat: "daily_help" as const },
    { title: "Maintenance",  icon: Wrench,        cat: "maintenance" as const },
    { title: "Lost & Found", icon: PackageSearch, cat: "lost_found" as const },
  ];

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
        <p className="text-sm text-muted-foreground">
          Everything your society needs, in one place.
        </p>
      </header>

      {isGuard && (
        <Link to="/app/guard" className="block active:scale-[0.99] transition-transform">
          <Card className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-0">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-white/20 grid place-items-center">
                <ScanLine className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Guard Dashboard</p>
                <p className="text-xs opacity-90">Log visitors at the gate</p>
              </div>
              <ChevronRight className="h-5 w-5" />
            </CardContent>
          </Card>
        </Link>
      )}

      <section className="space-y-3">
        <Link to="/app/visitors" className="block active:scale-[0.99] transition-transform">
          <Card className="rounded-2xl">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl grid place-items-center bg-primary/10 text-primary"><Shield className="h-6 w-6" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Visitors / Guard System</p>
                <p className="text-xs text-muted-foreground">Approve guests, view gate logs</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        {primary.map(({ to, title, desc, icon: Icon, accent }) => (
          <Link key={to} to={to} className="block active:scale-[0.99] transition-transform">
            <Card className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`h-12 w-12 rounded-2xl grid place-items-center ${accent}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          More
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {more.map(({ title, icon: Icon, cat }) => (
            <Link
              key={title}
              to="/app/helpdesk"
              search={{ cat, new: true }}
              className="rounded-2xl bg-secondary/60 hover:bg-secondary p-4 flex flex-col items-center gap-2 active:scale-[0.97] transition-transform"
            >
              <span className="h-10 w-10 rounded-xl bg-background grid place-items-center text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-xs font-medium text-center">{title}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
