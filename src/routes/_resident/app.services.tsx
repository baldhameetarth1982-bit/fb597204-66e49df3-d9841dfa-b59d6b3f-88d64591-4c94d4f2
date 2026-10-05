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
  Siren,
  CalendarDays,
  Store,
} from "lucide-react";
import { ServiceDirectory } from "@/components/discovery/ServiceDirectory";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_resident/app/services")({
  head: () => ({
    meta: [
      { title: "Services — SociyoHub" },
      { name: "description", content: "Society shortcuts and trusted local services — electricians, plumbers, cleaning and more." },
    ],
  }),
  component: ServicesScreen,
});

function ServicesScreen() {
  const { roles } = useAuth();
  const { t } = useTranslation();
  const isGuard =
    roles.includes("security" as never) ||
    roles.includes("society_admin" as never) ||
    roles.includes("block_admin" as never);

  const primary = [
    { to: "/app/amenities", title: t("mod.amenities"), desc: t("sv.amenitiesDesc"), icon: CalendarDays, accent: "bg-primary/10 text-primary" },
    { to: "/app/visitors", title: t("sv.myVisitors"), desc: t("sv.myVisitorsDesc"), icon: Users, accent: "bg-primary/10 text-primary" },
    { to: "/app/vehicles", title: t("nav.vehicles"), desc: t("sv.vehiclesDesc"), icon: Car, accent: "bg-primary/10 text-primary" },
    { to: "/app/helpdesk", title: t("home.qa.complaints"), desc: t("sv.complaintsDesc"), icon: AlertCircle, accent: "bg-destructive/10 text-destructive" },
    { to: "/app/events", title: t("sv.events"), desc: t("sv.eventsDesc"), icon: CalendarDays, accent: "bg-primary/10 text-primary" },
    { to: "/app/classes", title: t("sv.classes"), desc: t("sv.classesDesc"), icon: CalendarDays, accent: "bg-primary/10 text-primary" },
    { to: "/app/groups", title: t("sv.groups"), desc: t("sv.groupsDesc"), icon: Users, accent: "bg-primary/10 text-primary" },
    { to: "/app/passes", title: t("sv.passes"), desc: t("sv.passesDesc"), icon: CalendarDays, accent: "bg-primary/10 text-primary" },
    { to: "/app/community", title: t("cm.title"), desc: t("sv.communityDesc"), icon: Store, accent: "bg-primary/10 text-primary" },
    { to: "/app/emergency", title: t("re.title"), desc: t("sv.emergencyDesc"), icon: Siren, accent: "bg-destructive/10 text-destructive" },
  ] as const;

  const more = [
    { title: t("sv.dailyHelp"), icon: Sparkles,      cat: "daily_help" as const },
    { title: t("mnt.title"), icon: Wrench,        cat: "maintenance" as const },
    { title: t("sv.lostFound"), icon: PackageSearch, cat: "lost_found" as const },
  ];

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("prof.services")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("sv.subtitle")}
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
                <p className="font-semibold">{t("sv.guardDash")}</p>
                <p className="text-xs opacity-90">{t("sv.guardDesc")}</p>
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
                <p className="font-semibold">{t("sv.gate")}</p>
                <p className="text-xs text-muted-foreground">{t("sv.gateDesc")}</p>
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
          {t("nav.more")}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {more.map(({ title, icon: Icon, cat }) => (
            <Link
              key={cat}
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
      <ServiceDirectory />
    </div>
  );
}
