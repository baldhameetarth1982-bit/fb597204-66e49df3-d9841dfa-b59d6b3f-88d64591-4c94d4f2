import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Siren, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { communityError } from "@/lib/community-errors";
import { tu } from "@/lib/i18n";

export type MyBroadcast = {
  id: string; category_label: string; title: string; message: string; created_at: string; expires_at: string;
  cancelled_at: string | null; cancel_reason: string | null; acknowledged_at: string | null; state: "active" | "expired" | "cancelled";
};

export function useMyBroadcasts() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user,
    queryKey: ["my-emergency-broadcasts", user?.id],
    refetchInterval: 60_000,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_my_emergency_broadcasts");
      if (error) throw error;
      return (data ?? []) as MyBroadcast[];
    },
  });
}

function useAck() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (id: string) => { const { error } = await (supabase as any).rpc("emergency_acknowledge", { _id: id }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-emergency-broadcasts"] }),
    onError: (e) => toast.error(communityError(e)),
  });
}

/** Pinned banner for active, unacknowledged broadcasts. Never carries ads or sponsored content. */
export function EmergencyBroadcastBanner() {
  const q = useMyBroadcasts();
  const ack = useAck();
  const active = (q.data ?? []).filter((b) => b.state === "active" && !b.acknowledged_at);
  if (!active.length) return null;
  return (
    <div className="sticky top-0 z-40 space-y-2 bg-background p-2" role="alert" aria-live="assertive">
      {active.map((b) => (
        <div key={b.id} className="rounded-2xl border-2 border-destructive bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <Siren className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">{tu("op.emergency")} {b.category_label}</p>
              <p className="font-semibold break-words">{b.title}</p>
              <p className="mt-1 whitespace-pre-line text-sm break-words">{b.message}</p>
              <Button size="sm" variant="destructive" className="mt-3 min-h-11" disabled={ack.isPending} onClick={() => ack.mutate(b.id)}>
                <CheckCircle2 className="mr-1 h-4 w-4" />{tu("op.i_ve_seen_this")}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** History list for the resident Emergency page. */
export function EmergencyBroadcastHistory() {
  const q = useMyBroadcasts();
  const ack = useAck();
  if (q.isLoading || q.isError || !(q.data ?? []).length) return null;
  return (
    <section className="space-y-2" aria-labelledby="eb-h">
      <h2 id="eb-h" className="font-semibold">{tu("op.society_emergency_broadcasts")}</h2>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {q.data!.map((b) => (
          <li key={b.id} className="space-y-1 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {b.category_label} · {new Date(b.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ·{" "}
              <span className={b.state === "active" ? "text-destructive" : ""}>{b.state === "active" ? tu("common.active") : b.state === "cancelled" ? tu("rbills.cancelled") : tu("op.ended")}</span>
            </p>
            <p className="font-medium break-words">{b.title}</p>
            <p className="whitespace-pre-line text-sm text-muted-foreground break-words">{b.message}</p>
            {b.cancel_reason && <p className="text-xs">{tu("op.cancelled")} {b.cancel_reason}</p>}
            {b.state === "active" && !b.acknowledged_at && (
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => ack.mutate(b.id)}>{tu("op.i_ve_seen_this")}</Button>
            )}
            {b.acknowledged_at && <p className="text-xs text-muted-foreground">{tu("op.seen_2")} {new Date(b.acknowledged_at).toLocaleString("en-IN")}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
