// Resident-side: rating, reopen of closed requests (server applies the 7-day window), evidence.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { helpdeskErrorMessage } from "@/lib/helpdesk";
import { TicketEvidence } from "./TicketEvidence";

export function ResidentTicketExtras({ ticketId, status }: { ticketId: string; status: string }) {
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [reopenNote, setReopenNote] = useState("");
  const done = status === "resolved" || status === "closed";
  const rating = useQuery({
    queryKey: ["helpdesk", "rating", ticketId],
    enabled: done,
    queryFn: async () => {
      const { data, error } = await supabase.from("ticket_ratings").select("rating").eq("ticket_id", ticketId).maybeSingle();
      if (error) throw error;
      return data?.rating ?? null;
    },
  });
  const rate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("helpdesk_rate", { _ticket: ticketId, _rating: stars, _comment: comment });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Thanks for your feedback"); qc.invalidateQueries({ queryKey: ["helpdesk"] }); },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });
  const reopen = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("helpdesk_reopen", { _ticket: ticketId, _note: reopenNote.trim() });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (nid) => {
      toast.success(nid === ticketId ? "Request reopened" : "A follow-up request was raised");
      setReopenNote(""); qc.invalidateQueries({ queryKey: ["helpdesk"] });
    },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {done && (
        <div className="space-y-2 rounded-2xl border p-3">
          <p className="text-sm font-medium">How was it handled?</p>
          {rating.data ? <p className="text-sm text-muted-foreground">You rated this {rating.data}/5.</p> : (
            <>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    onClick={() => setStars(n)} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted">
                    <Star className={`h-6 w-6 ${n <= stars ? "fill-warning text-warning" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} className="rounded-xl" placeholder="Optional comment" aria-label="Rating comment" />
              <Button className="min-h-11 rounded-xl" disabled={!stars || rate.isPending} onClick={() => rate.mutate()}>Submit rating</Button>
            </>
          )}
        </div>
      )}
      {status === "closed" && (
        <div className="space-y-2 rounded-2xl border p-3">
          <p className="text-sm font-medium">Problem came back?</p>
          <Textarea value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} rows={2} maxLength={2000} className="rounded-xl" placeholder="What's still wrong? (min 5 characters)" aria-label="Reopen reason" />
          <p className="text-xs text-muted-foreground">Within 7 days it reopens this request; after that a linked follow-up is raised.</p>
          <Button variant="outline" className="min-h-11 rounded-xl" disabled={reopenNote.trim().length < 5 || reopen.isPending} onClick={() => reopen.mutate()}>Reopen</Button>
        </div>
      )}
      <TicketEvidence ticketId={ticketId} canUpload={!["closed", "cancelled", "rejected"].includes(status)} />
    </div>
  );
}
