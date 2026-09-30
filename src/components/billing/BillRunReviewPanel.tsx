import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { decideBillRunApproval, getBillRunReview, requestBillRunApproval } from "@/lib/workstream7.functions";

const PROBLEM: Record<string, string> = {
  no_occupant: "No resident assigned",
  zero_charges: "Bill would be ₹0",
  missing_area: "Area missing (area-based charge)",
  no_unit_type_rule: "No charge set for this unit type",
};
const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Server-derived problem flats, late fees and second-approver state. Reports whether finalize may proceed. */
export function BillRunReviewPanel({ societyId, cycleId, onGate }: { societyId: string; cycleId: string; onGate: (ok: boolean, reason?: string) => void }) {
  const load = useServerFn(getBillRunReview);
  const request = useServerFn(requestBillRunApproval);
  const decide = useServerFn(decideBillRunApproval);
  const qc = useQueryClient();
  const key = ["bill-run-review", societyId, cycleId];
  const q = useQuery({ queryKey: key, queryFn: () => load({ data: { societyId, cycleConfigId: cycleId } }) });
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setAck(false), [cycleId]);

  const r = q.data;
  const appr = r?.approval;
  const approvalOk = !r?.approval_required || (appr?.status === "approved" && appr.fingerprint === r.fingerprint);
  const problemsOk = !r || r.problem_count === 0 || ack;

  useEffect(() => {
    if (!r) return onGate(false, q.isError ? "Review couldn't load." : "Loading review…");
    if (!problemsOk) return onGate(false, "Confirm you've reviewed the problem flats.");
    if (!approvalOk) return onGate(false, "Waiting for a second committee member to approve.");
    onGate(true);
  }, [r, problemsOk, approvalOk, q.isError]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const reqM = useMutation({ mutationFn: () => request({ data: { societyId, cycleConfigId: cycleId } }), onSuccess: () => { toast.success("Approval requested"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const decM = useMutation({
    mutationFn: (approve: boolean) => decide({ data: { approvalId: appr!.id, approve, note: note.trim() || undefined } }),
    onSuccess: (res) => { toast[res.status === "run_changed" ? "error" : "success"](res.status === "run_changed" ? "The run changed since it was requested. Ask again." : res.status === "approved" ? "Bill run approved" : "Bill run sent back"); setNote(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking houses…</p>;
  if (q.isError || !r) return <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-xs text-destructive">{(q.error as Error)?.message ?? "Review couldn't load."} <button className="underline" onClick={refresh}>Retry</button></p>;

  return (
    <div className="space-y-3">
      {r.late_fee.enabled ? (
        <div className="rounded-xl border border-border p-3 text-sm">
          <p className="font-medium">Late fees in this run: {inr(r.late_fee_total)} <span className="font-normal text-muted-foreground">({r.late_fee_count} houses)</span></p>
          <p className="text-xs text-muted-foreground">
            {r.late_fee.type === "percent" ? `${r.late_fee.value}% of overdue dues` : `${inr(Number(r.late_fee.value))} flat`} on dues unpaid {r.late_fee.grace_days} days after their due date. Added once per bill; reverse with a bill adjustment if needed.
          </p>
          {r.late_fees.length > 0 && (
            <ul className="mt-2 max-h-40 divide-y divide-border overflow-y-auto text-xs">
              {r.late_fees.map((l) => <li key={l.flat_id} className="flex justify-between gap-2 py-1"><span className="truncate">{l.flat_number}</span><span className="tabular-nums">{inr(l.late_fee)} on {inr(l.overdue)}</span></li>)}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Late fees are off, so none will be added.</p>
      )}

      {r.problem_count > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />{r.problem_count} problem {r.problem_count === 1 ? "flat" : "flats"}</p>
          <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto text-xs">
            {r.problems.map((p) => (
              <li key={p.flat_id} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1.5">
                <span className="truncate font-medium">{p.flat_number}</span>
                <span className="text-muted-foreground">{p.codes.map((c) => PROBLEM[c] ?? c).join(" · ")}</span>
              </li>
            ))}
          </ul>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-xs">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />I've reviewed these and want to bill them as shown
          </label>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-4 w-4" />No problem flats found.</p>
      )}

      {r.approval_required && (
        <div className="rounded-xl border border-border p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium"><UserCheck className="h-4 w-4" />Second approval</p>
          {!appr || ["rejected", "superseded", "consumed"].includes(appr.status) || (appr.status === "approved" && appr.fingerprint !== r.fingerprint) ? (
            <>
              <p className="text-xs text-muted-foreground">
                {appr?.status === "rejected" ? `Sent back: ${appr.decision_note ?? ""}` : appr?.status === "superseded" || (appr && appr.fingerprint !== r.fingerprint) ? "The run changed since the last approval." : "Another committee member must approve before bills are created."}
              </p>
              <Button size="sm" variant="outline" className="mt-2 min-h-11" disabled={reqM.isPending} onClick={() => reqM.mutate()}>
                {reqM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Request approval</Button>
            </>
          ) : appr.status === "requested" ? (
            appr.requested_by_me ? <p className="text-xs text-muted-foreground">Requested. Waiting for another committee member.</p> : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">Requested for {appr.unit_count} houses, {inr(appr.total_amount)}.</p>
                <Textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to send back)" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-11" disabled={decM.isPending} onClick={() => decM.mutate(true)}>Approve</Button>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={decM.isPending || !note.trim()} onClick={() => decM.mutate(false)}>Send back</Button>
                </div>
              </div>
            )
          ) : <p className="text-xs text-success">Approved{appr.decided_by_me ? " by you" : ""}. Bills can be created.</p>}
        </div>
      )}
    </div>
  );
}
