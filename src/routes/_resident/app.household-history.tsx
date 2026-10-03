import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LoadError } from "@/components/people/PeopleUI";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/household-history")({
  head: () => ({
    meta: [
      { title: "Home history — SociyoHub" },
      { name: "description", content: "Who has lived in your home, with move-in and move-out dates." },
      { property: "og:title", content: "Home history — SociyoHub" },
      { property: "og:description", content: "Who has lived in your home, with move-in and move-out dates." },
    ],
  }),
  component: HouseholdHistory,
});

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

function HouseholdHistory() {
  const q = useQuery({
    queryKey: ["household-history"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_household_history");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center gap-2">
        <History className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-xl font-semibold">Home history</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        Owners see everyone who has lived here. Tenants see people who lived here during their own stay.
      </p>
      {q.isError ? (
        <LoadError onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      ) : q.data!.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No home is linked to your account yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card" aria-label="People who lived in this home">
          {q.data!.map((r, i) => (
            <li key={i} className="flex flex-col gap-1 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{r.full_name || "Resident"}</b>
                {r.is_you && <Badge variant="secondary">You</Badge>}
                <Badge variant="outline" className="capitalize">{r.relationship}</Badge>
                {!r.moved_out_at && <Badge>Living here</Badge>}
              </div>
              <p className="text-muted-foreground">
                Home {r.flat_number} · Moved in {fmt(r.moved_in_at)}
                {r.moved_out_at && <> · Moved out {fmt(r.moved_out_at)}</>}
                {r.ended_reason && <> · {r.ended_reason.replace(/_/g, " ")}</>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
