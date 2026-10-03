import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Correction = { id: string; body: string; reason: string; created_at: string };

/** Published minutes stay unchanged; corrections are appended and shown in order. */
export function MinutesCorrections({ meetingId, canAdd }: { meetingId: string; canAdd?: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const key = ["minutes-corrections", meetingId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_minutes_corrections").select("id,body,reason,created_at").eq("meeting_id", meetingId).order("created_at");
      if (error) throw error;
      return (data ?? []) as Correction[];
    },
  });

  async function add() {
    setBusy(true);
    const { error } = await supabase.rpc("meeting_add_minutes_correction", { _id: meetingId, _body: body, _reason: reason });
    setBusy(false);
    if (error) return toast.error(error.message.includes("correction_required") || error.message.includes("invalid_input") ? "Write the correction and a reason (at least 10 characters each)." : "Couldn't add the correction. Please try again.");
    setBody(""); setReason("");
    toast.success("Correction added — the original minutes are kept as published");
    qc.invalidateQueries({ queryKey: key });
  }

  if (q.isError) return <p className="text-sm text-destructive">Couldn't load corrections.</p>;
  const list = q.data ?? [];
  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Corrections</h4>
          <ol className="space-y-2">
            {list.map((c, i) => (
              <li key={c.id} className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground">Correction {i + 1} · {new Date(c.created_at).toLocaleDateString("en-IN")} · Reason: {c.reason}</p>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {canAdd && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label className="text-sm font-medium" htmlFor={`corr-${meetingId}`}>Add a correction</label>
          <Textarea id={`corr-${meetingId}`} rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the record say instead" />
          <Textarea aria-label="Reason for correction" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this correction is needed" />
          <Button variant="outline" className="min-h-11 rounded-xl" disabled={busy || body.trim().length < 10 || reason.trim().length < 10} onClick={add}>Add correction</Button>
        </div>
      )}
    </div>
  );
}
