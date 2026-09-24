import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { describeEvent, fetchTimeline, fmtDate, helpdeskErrorMessage } from "@/lib/helpdesk";

export function TicketTimeline({ ticketId, canComment }: { ticketId: string; canComment: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const q = useQuery({
    queryKey: ["helpdesk", "timeline", ticketId],
    queryFn: () => fetchTimeline(ticketId),
    staleTime: 15_000,
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("helpdesk_add_comment", { _ticket: ticketId, _body: body.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });

  return (
    <section aria-label="Updates" className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updates</h3>
      {q.isPending ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : q.isError ? (
        <div role="alert" className="rounded-xl border p-3 text-sm">
          <p>{helpdeskErrorMessage(q.error)}</p>
          <Button variant="outline" size="sm" className="mt-2 min-h-11" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : (
        <ol className="relative space-y-4 border-l pl-4">
          {q.data.map((e) => (
            <li key={e.id} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.actor_kind === "admin" ? "bg-primary" : "bg-muted-foreground/50"}`} />
              <p className="text-sm font-medium">{describeEvent(e)}</p>
              <p className="text-xs text-muted-foreground">{e.actor_name} · {fmtDate(e.created_at)}</p>
              {e.body && e.kind !== "assigned" && (
                <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm">{e.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <form
          className="flex items-end gap-2"
          onSubmit={(ev) => { ev.preventDefault(); if (body.trim() && !send.isPending) send.mutate(); }}
        >
          <label htmlFor={`c-${ticketId}`} className="sr-only">Add a comment</label>
          <Textarea
            id={`c-${ticketId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Add a comment…"
            className="min-h-11 flex-1 resize-none rounded-xl"
          />
          <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-xl" disabled={!body.trim() || send.isPending} aria-label="Send comment">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      )}
    </section>
  );
}
