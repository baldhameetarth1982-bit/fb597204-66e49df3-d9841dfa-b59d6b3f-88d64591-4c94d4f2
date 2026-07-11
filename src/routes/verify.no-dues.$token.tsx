import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/verify/no-dues/$token")({
  head: () => ({
    meta: [
      { title: "Verify No-Dues Certificate — SocioHub" },
      {
        name: "description",
        content: "Verify the live status of a SocioHub no-dues certificate.",
      },
    ],
  }),
  component: VerifyNoDuesPage,
});

type Verification = {
  certificate_number: string;
  status: "active" | "revoked" | "expired";
  society_name: string;
  block_name: string | null;
  flat_number: string;
  issued_at: string;
  valid_until: string;
  revoked_at: string | null;
  revocation_reason: string | null;
};

function VerifyNoDuesPage() {
  const { token } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["verify-no-dues", token],
    queryFn: async () => {
      const { data: result, error } = await (supabase as any).rpc("verify_no_dues_certificate", {
        _token: token,
      });
      if (error) throw error;
      return ((result ?? [])[0] ?? null) as Verification | null;
    },
    retry: 1,
  });

  if (isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/30">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </main>
    );
  }

  const valid = data?.status === "active";
  const found = Boolean(data) && !isError;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-primary/10 via-background to-background px-4 py-10">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="flex items-center justify-center gap-3">
          <Logo size={42} />
          <div>
            <p className="text-lg font-bold">SocioHub</p>
            <p className="text-xs text-muted-foreground">Certificate verification</p>
          </div>
        </header>

        <Card className="overflow-hidden rounded-3xl border-primary/20 shadow-xl shadow-primary/5">
          <div
            className={cn(
              "grid place-items-center px-6 py-8 text-center",
              valid
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-400",
            )}
          >
            {valid ? <ShieldCheck className="h-14 w-14" /> : <ShieldAlert className="h-14 w-14" />}
            <h1 className="mt-3 text-2xl font-bold">
              {valid
                ? "Certificate is valid"
                : found
                  ? `Certificate is ${data!.status}`
                  : "Certificate not found"}
            </h1>
            <p className="mt-1 text-sm opacity-80">
              {valid
                ? "The live SocioHub record confirms this certificate."
                : "Do not rely on this certificate as proof of current no-dues status."}
            </p>
          </div>

          {data && (
            <CardContent className="space-y-4 p-6">
              <Detail
                icon={BadgeCheck}
                label="Certificate number"
                value={data.certificate_number}
              />
              <Detail icon={Building2} label="Society" value={data.society_name} />
              <Detail
                icon={Building2}
                label="Unit"
                value={`${data.block_name ? `${data.block_name} · ` : ""}${data.flat_number}`}
              />
              <Detail
                icon={CalendarDays}
                label="Issued"
                value={new Date(data.issued_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
              <Detail
                icon={CalendarDays}
                label="Valid until"
                value={new Date(data.valid_until).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
              {data.status === "revoked" && data.revocation_reason && (
                <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  <span className="font-semibold">Revocation reason:</span> {data.revocation_reason}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          This page reads the current certificate record. A screenshot or downloaded PDF can become
          outdated after revocation.
        </p>
        <div className="text-center">
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/">Open SocioHub</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BadgeCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}
