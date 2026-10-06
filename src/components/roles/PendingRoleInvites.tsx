import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { listMyInvites, respondInvite } from "@/lib/role-access.functions";
import { tu } from "@/lib/i18n";

/** Shows Auditor / Staff invitations sent to the signed-in user's verified phone number. */
export function PendingRoleInvites() {
  const { isAuthenticated, refresh } = useAuth();
  const list = useServerFn(listMyInvites);
  const respond = useServerFn(respondInvite);
  const q = useQuery({ queryKey: ["my-role-invites"], enabled: isAuthenticated, queryFn: () => list(), retry: false, staleTime: 60_000 });
  const m = useMutation({
    networkMode: "always", retry: false,
    mutationFn: (v: { id: string; accept: boolean }) => respond({ data: v }),
    onSuccess: async (_r, v) => {
      await q.refetch();
      if (v.accept) { toast.success(tu("op.access_accepted")); await refresh(); window.location.replace("/"); }
      else toast.success(tu("op.invitation_declined"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong."),
  });
  if (!q.data?.length) return null;
  return (
    <section aria-label={tu("op.invitations")} className="space-y-3">
      {q.data.map((i) => (
        <div key={i.id} className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <MailCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
            <div className="flex-1 space-y-1">
              <p className="font-medium">{i.society_name} {tu("op.invited_you_as")} {i.role === "auditor" ? tu("op.their_auditor_read_only_accounts") : `Staff${i.job_type ? ` · ${i.job_type.replace(/_/g, " ")}` : ""}`}</p>
              <p className="text-sm text-muted-foreground">{tu("op.expires")} {new Date(i.expires_at).toLocaleDateString("en-IN")}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="min-h-11" disabled={m.isPending} onClick={() => m.mutate({ id: i.id, accept: true })}>{tu("op.accept")}</Button>
            <Button className="min-h-11" variant="outline" disabled={m.isPending} onClick={() => m.mutate({ id: i.id, accept: false })}>{tu("op.decline")}</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
