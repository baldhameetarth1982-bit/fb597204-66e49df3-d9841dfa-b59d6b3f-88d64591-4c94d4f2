import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const DAY = 86_400_000;

/** Ends-at the society loses access, or null when nothing ends soon / a paid plan is already booked. */
function endsAt(row: Record<string, string | null> | null | undefined): { at: number; trial: boolean } | null {
  if (!row) return null;
  if (row.plan_status === "active" && row.plan_expires_at) return { at: new Date(row.plan_expires_at).getTime(), trial: false };
  if ((row.plan_status === "trialing" || row.plan_status === "trial") && row.trial_ends_at) {
    // A plan already paid to start after the trial means nothing is ending.
    if (row.scheduled_plan_id && row.plan_expires_at) return { at: new Date(row.plan_expires_at).getTime(), trial: false };
    return { at: new Date(row.trial_ends_at).getTime(), trial: true };
  }
  return null;
}

function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Plan / trial ending warning: daily for the last 5 days, live 24-hour countdown on the last day. */
export function PlanEndingBanner({ societyId }: { societyId: string | null | undefined }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-plan-ending", societyId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("societies")
        .select("plan_status,plan_expires_at,trial_ends_at,scheduled_plan_id")
        .eq("id", societyId!)
        .maybeSingle();
      return (data ?? null) as Record<string, string | null> | null;
    },
  });
  const end = endsAt(data);
  const [now, setNow] = useState(() => Date.now());
  const left = end ? end.at - now : Infinity;
  const lastDay = left > 0 && left <= DAY;

  useEffect(() => {
    if (!end) return;
    const id = window.setInterval(() => setNow(Date.now()), lastDay ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [end?.at, lastDay]);

  if (!end || left <= 0 || left > 5 * DAY) return null;
  const days = Math.ceil(left / DAY);

  return (
    <div role="status" aria-live="off" className="mt-5 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning"><Clock className="h-5 w-5" aria-hidden /></div>
        <div className="min-w-0">
          {lastDay ? (
            <>
              <p className="text-sm font-semibold">{end.trial ? t("ln.exp.trialLast") : t("ln.exp.last")}</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight" aria-label={hms(left)}>{hms(left)}</p>
            </>
          ) : (
            <p className="text-sm font-semibold">{t(end.trial ? "ln.exp.trialDays" : "ln.exp.days", { n: days })}</p>
          )}
          <p className="text-xs text-muted-foreground">{t("ln.exp.body")}</p>
        </div>
      </div>
      <Button asChild className="h-11 shrink-0 rounded-xl">
        <Link to="/society/subscription">{t("ln.exp.renew")}</Link>
      </Button>
    </div>
  );
}
