// Committee tools for guard join requests and shift hours. The database enforces
// the schedule with server time; these screens only collect the committee's choice.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import i18n, { tu } from "@/lib/i18n";
import { fmtTime, gateErrorMessage } from "@/lib/visitors";
import { WEEK_ORDER, guardShiftError, isOvernight, weekdayName, type GuardShift } from "@/lib/guard-shift";
import { askText } from "@/components/system/AskTextDialog";

const errText = (e: unknown) => guardShiftError(e) ?? gateErrorMessage(e);

export interface ShiftRow { user_id: string; weekdays: number[]; start_time: string; end_time: string }

export function useGuardShifts(societyId: string | null | undefined) {
  return useQuery({
    queryKey: ["guard-shifts", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("guard_shifts").select("user_id, weekdays, start_time, end_time").eq("society_id", societyId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.user_id, { weekdays: r.weekdays, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) } as GuardShift]));
    },
  });
}

/** Weekday + time picker in a bottom sheet. */
export function ShiftSheet({ open, title, initial, busy, onClose, onSave }: {
  open: boolean; title: string; initial?: GuardShift | null; busy: boolean;
  onClose: () => void; onSave: (s: GuardShift) => void;
}) {
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  useEffect(() => {
    if (!open) return;
    setDays(initial?.weekdays ?? [1, 2, 3, 4, 5, 6]);
    setStart(initial?.start ?? "08:00");
    setEnd(initial?.end ?? "20:00");
  }, [open, initial]);
  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  const valid = days.length > 0 && !!start && !!end && start !== end;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
        <div className="py-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{tu("ln.sh.days")}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK_ORDER.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
                  className={cn("min-h-11 min-w-12 rounded-full border px-3 text-sm font-medium",
                    days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground")}>
                  {weekdayName(d)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="sh-start">{tu("ln.sh.start")}</Label><Input id="sh-start" type="time" className="h-11" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label htmlFor="sh-end">{tu("ln.sh.end")}</Label><Input id="sh-end" type="time" className="h-11" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          {isOvernight(start, end) && start !== end && <p className="text-xs text-muted-foreground">{tu("ln.sh.overnight")}</p>}
          <p className="text-xs text-muted-foreground">{tu("ln.sh.serverNote")}</p>
          <Button className="w-full h-12 rounded-xl" disabled={busy || !valid} onClick={() => onSave({ weekdays: days, start, end })}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : tu("ln.sh.save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ReqRow { id: string; full_name: string; phone_last4: string | null; created_at: string }

export function GuardJoinRequests() {
  const qc = useQueryClient();
  const [approve, setApprove] = useState<ReqRow | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["admin-guard-requests"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_guard_join_requests");
      if (error) throw error;
      return (data ?? []) as ReqRow[];
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-guard-requests"] });
    qc.invalidateQueries({ queryKey: ["admin-guards"] });
    qc.invalidateQueries({ queryKey: ["guard-shifts"] });
  };
  async function review(r: ReqRow, ok: boolean, s?: GuardShift) {
    let reason: string | null = null;
    if (!ok) {
      reason = await askText(tu("ln.sh.rejectReason"), { allowEmpty: true });
      if (reason === null) return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("admin_review_guard_join_request", {
      _id: r.id, _approve: ok,
      _weekdays: s?.weekdays, _start: s?.start, _end: s?.end, _reason: reason ?? undefined,
    });
    setBusy(false);
    if (error) return toast.error(errText(error));
    toast.success(tu(ok ? "ln.sh.approved" : "ln.sh.rejected"));
    setApprove(null);
    refresh();
  }
  if (q.isLoading || q.isError || !q.data?.length) return null;
  return (
    <Card className="rounded-2xl"><CardContent className="p-4 space-y-2 sm:p-4">
      <p className="font-medium">{tu("ln.sh.requests")}</p>
      <ul className="space-y-2">
        {q.data.map((r) => (
          <li key={r.id} className="rounded-xl border p-3 space-y-2">
            <div>
              <p className="font-medium">{r.full_name}{r.phone_last4 ? ` · ••${r.phone_last4}` : ""}</p>
              <p className="text-xs text-muted-foreground">{fmtTime(r.created_at)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="min-h-11" disabled={busy} onClick={() => setApprove(r)}><Check className="h-4 w-4 mr-1" />{tu("ln.sh.approve")}</Button>
              <Button size="sm" variant="outline" className="min-h-11 text-destructive" disabled={busy} onClick={() => review(r, false)}><X className="h-4 w-4 mr-1" />{tu("ln.sh.reject")}</Button>
            </div>
          </li>
        ))}
      </ul>
      <ShiftSheet open={!!approve} busy={busy} title={i18n.t("ln.sh.approveTitle", { name: approve?.full_name ?? "" }) as string}
        onClose={() => setApprove(null)} onSave={(s) => approve && review(approve, true, s)} />
    </CardContent></Card>
  );
}

export async function saveGuardShift(userId: string, s: GuardShift) {
  const { error } = await supabase.rpc("admin_set_guard_shift", { _guard_user_id: userId, _weekdays: s.weekdays, _start: s.start, _end: s.end });
  if (error) { toast.error(errText(error)); return false; }
  toast.success(tu("ln.sh.saved"));
  return true;
}
