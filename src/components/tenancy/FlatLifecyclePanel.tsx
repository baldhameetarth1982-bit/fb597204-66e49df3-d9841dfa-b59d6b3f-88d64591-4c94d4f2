import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, LogOut, RefreshCw, Archive, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TenancyStateBadge } from "./TenancyStateBadge";
import {
  archiveTenancy, getFlatOccupancy, moveOutResident, renewTenancy, type FlatOccupancy,
} from "@/lib/tenancy.functions";

type Rel = FlatOccupancy["relationships"][number];
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const inr = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString("en-IN")}`;
const ENDED = new Set(["expired", "terminated", "moved_out", "archived"]);

export function FlatLifecyclePanel({ flatId }: { flatId: string }) {
  const load = useServerFn(getFlatOccupancy);
  const q = useQuery({ queryKey: ["flat-occupancy", flatId], queryFn: () => load({ data: { flatId } }), staleTime: 15_000, retry: false });
  const [renewing, setRenewing] = useState<Rel | null>(null);
  const [leaving, setLeaving] = useState<{ rel: Rel; early: boolean } | null>(null);
  const qc = useQueryClient();
  const archive = useServerFn(archiveTenancy);
  const archiveM = useMutation({
    mutationFn: (id: string) => archive({ data: { flatResidentId: id } }),
    onSuccess: () => { toast.success("Record archived"); invalidate(qc, flatId); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="h-40 rounded-2xl bg-muted animate-pulse" aria-label="Loading occupancy" />;
  if (q.error) return (
    <Card className="rounded-2xl"><CardContent className="p-4 text-sm text-muted-foreground">
      {(q.error as Error).message.includes("permission") ? "You don't have permission to manage occupancy for this flat." : "Occupancy could not be loaded."}
    </CardContent></Card>
  );
  const occ = q.data!;
  const current = occ.relationships.filter((r) => !ENDED.has(r.state));
  const past = occ.relationships.filter((r) => ENDED.has(r.state));

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" aria-hidden />Occupancy & lease</h2>
          <span className={occ.no_dues.eligible ? "text-xs text-primary" : "text-xs text-destructive"}>
            {occ.no_dues.eligible ? "No dues" : `Dues ${inr(occ.no_dues.total_outstanding)}`}
          </span>
        </div>
        {current.length === 0 && <p className="text-sm text-muted-foreground">No one currently lives here.</p>}
        <ul className="space-y-3">
          {current.map((r) => (
            <li key={r.id} className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.name ?? "Resident"}</p>
                  <p className="text-xs text-muted-foreground capitalize">{r.relationship}{r.is_primary ? " · primary" : ""}</p>
                </div>
                <TenancyStateBadge state={r.state} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Moved in</dt><dd>{fmt(r.moved_in_at)}</dd>
                {r.relationship === "tenant" && (<>
                  <dt className="text-muted-foreground">Lease ends</dt><dd>{fmt(r.lease_ends_on)}</dd>
                  {r.notice_given_on && (<><dt className="text-muted-foreground">Notice given</dt><dd>{fmt(r.notice_given_on)}</dd></>)}
                  {(r.renewal_count ?? 0) > 0 && (<><dt className="text-muted-foreground">Renewals</dt><dd>{r.renewal_count}</dd></>)}
                </>)}
              </dl>
              <div className="flex flex-wrap gap-2">
                {r.relationship === "tenant" && (
                  <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setRenewing(r)}>
                    <RefreshCw className="h-4 w-4 mr-1" aria-hidden />Renew
                  </Button>
                )}
                {r.relationship === "tenant" && (
                  <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setLeaving({ rel: r, early: true })}>End early</Button>
                )}
                <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setLeaving({ rel: r, early: false })}>
                  <LogOut className="h-4 w-4 mr-1" aria-hidden />Move out
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {past.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground min-h-11 flex items-center">Past residents ({past.length})</summary>
            <ul className="mt-2 space-y-2">
              {past.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border p-2">
                  <div className="min-w-0 text-xs">
                    <p className="font-medium truncate">{r.name ?? "Resident"} <span className="text-muted-foreground capitalize">· {r.relationship}</span></p>
                    <p className="text-muted-foreground">{fmt(r.moved_in_at)} – {fmt(r.moved_out_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TenancyStateBadge state={r.state} />
                    {r.state !== "archived" && (
                      <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Archive record" disabled={archiveM.isPending} onClick={() => archiveM.mutate(r.id)}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-muted-foreground">Bills, payments, complaints and visitor history are kept when someone moves out.</p>
      </CardContent>
      {renewing && <RenewDialog rel={renewing} flatId={flatId} onClose={() => setRenewing(null)} />}
      {leaving && <MoveOutDialog rel={leaving.rel} early={leaving.early} flatId={flatId} onClose={() => setLeaving(null)} />}
    </Card>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>, flatId: string) {
  void qc.invalidateQueries({ queryKey: ["flat-occupancy", flatId] });
  void qc.invalidateQueries({ queryKey: ["flat360", flatId] });
  void qc.invalidateQueries({ queryKey: ["tenancies"] });
  void qc.invalidateQueries({ queryKey: ["society-residents"] });
}

function RenewDialog({ rel, flatId, onClose }: { rel: Rel; flatId: string; onClose: () => void }) {
  const [end, setEnd] = useState("");
  const renew = useServerFn(renewTenancy);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => renew({ data: { flatResidentId: rel.id, newEndsOn: end } }),
    onSuccess: () => { toast.success("Lease renewed"); invalidate(qc, flatId); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Renew lease</DialogTitle>
          <DialogDescription>{rel.name ?? "Tenant"} · current end {fmt(rel.lease_ends_on)}</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label htmlFor="renew-end">New end date</Label>
          <Input id="renew-end" type="date" min={rel.lease_ends_on ?? today()} value={end} onChange={(e) => setEnd(e.target.value)} className="min-h-11" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11">Cancel</Button>
          <Button disabled={!end || m.isPending} onClick={() => m.mutate()} className="min-h-11">{m.isPending ? "Saving…" : "Renew"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveOutDialog({ rel, early, flatId, onClose }: { rel: Rel; early: boolean; flatId: string; onClose: () => void }) {
  const [on, setOn] = useState(today());
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [blocked, setBlocked] = useState<number | null>(null);
  const move = useServerFn(moveOutResident);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => move({ data: { flatResidentId: rel.id, movedOutOn: on, reason, overrideReason: blocked !== null ? override : undefined, early } }),
    onSuccess: (r) => {
      if (!r.ok) { setBlocked(r.total_outstanding ?? 0); return; }
      toast.success(r.scheduled ? "Move-out scheduled — access ends on that date" : "Moved out — access removed");
      invalidate(qc, flatId); onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const needOverride = blocked !== null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{early ? "End lease early" : "Move out"}</DialogTitle>
          <DialogDescription>{rel.name ?? "Resident"} loses access to this flat from the chosen date. Their other homes are not affected.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="mo-date">Last day</Label>
            <Input id="mo-date" type="date" value={on} onChange={(e) => setOn(e.target.value)} className="min-h-11" /></div>
          <div className="space-y-1"><Label htmlFor="mo-reason">Reason (optional)</Label>
            <Input id="mo-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-11" /></div>
          {needOverride && (
            <div role="alert" className="rounded-xl bg-destructive/10 p-3 space-y-2">
              <p className="text-sm text-destructive flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                This flat has {inr(blocked)} outstanding or pending. Clear dues first, or record why you are proceeding.</p>
              <Label htmlFor="mo-override">Reason for proceeding (at least 10 characters)</Label>
              <Textarea id="mo-override" maxLength={300} value={override} onChange={(e) => setOverride(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11">Cancel</Button>
          <Button variant="destructive" className="min-h-11" disabled={!on || m.isPending || (needOverride && override.trim().length < 10)} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : needOverride ? "Proceed anyway" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
