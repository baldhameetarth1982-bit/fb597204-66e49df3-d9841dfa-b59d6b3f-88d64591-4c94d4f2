import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/people/PeopleUI";
import { communityError } from "@/lib/community-errors";
import type { KnowledgeItem } from "@/lib/society-knowledge.functions";

const OPTIONS = [90, 60, 30, 14, 7, 3, 1, 0];

export function daysUntil(d: string) {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00").getTime() - today.getTime()) / 864e5);
}

export function ExpiryChip({ expiresOn }: { expiresOn: string | null }) {
  if (!expiresOn) return null;
  const n = daysUntil(expiresOn);
  if (n < 0) return <StatusChip tone="warning">Expired</StatusChip>;
  if (n <= 30) return <StatusChip tone="warning">Expires in {n} day{n === 1 ? "" : "s"}</StatusChip>;
  return <StatusChip tone="muted">Expires {new Date(expiresOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</StatusChip>;
}

export function DocumentExpiryDialog({ item, onClose, onDone }: { item: KnowledgeItem; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(item.expiresOn ?? "");
  const [days, setDays] = useState<number[]>(item.reminderDays.length ? item.reminderDays : [30, 7, 1]);
  const [aud, setAud] = useState<KnowledgeItem["reminderAudience"]>(item.reminderAudience);
  const history = useQuery({
    queryKey: ["doc-expiry-history", item.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("document_expiry_reminders").select("id,threshold,expires_on,recipients,sent_at").eq("source_id", item.id).order("sent_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as { id: string; threshold: string; expires_on: string; recipients: number; sent_at: string }[];
    },
  });
  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("doc_set_expiry", { _id: item.id, _expires_on: date || null, _reminder_days: days, _audience: aud });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(date ? "Expiry reminders saved" : "Expiry removed — no reminders will be sent"); onDone(); onClose(); },
    onError: (e) => toast.error(communityError(e)),
  });
  const toggle = (d: number) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort((a, b) => b - a)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Expiry & reminders</DialogTitle>
          <DialogDescription>Leave the date empty if this document doesn't expire. Reminders go only to the committee{item.audience === "committee" ? "" : " and, if you choose, staff with document access"} — never to residents.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="exp">Expiry date</Label>
            <div className="flex gap-2">
              <Input id="exp" type="date" className="min-h-11" value={date} onChange={(e) => setDate(e.target.value)} />
              {date && <Button variant="ghost" className="min-h-11" onClick={() => setDate("")}>Clear</Button>}
            </div>
          </div>
          <fieldset className="space-y-2" disabled={!date}>
            <legend className="text-sm font-medium">Remind before expiry</legend>
            <div className="flex flex-wrap gap-2">
              {OPTIONS.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
                  className={`min-h-11 rounded-full border px-3 text-sm disabled:opacity-50 ${days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
                  {d === 0 ? "On the day" : `${d} days`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">A final reminder is also sent once after it expires.</p>
          </fieldset>
          {item.audience !== "committee" && (
            <div className="space-y-1">
              <Label>Who gets reminders</Label>
              <Select value={aud} onValueChange={(v) => setAud(v as KnowledgeItem["reminderAudience"])} disabled={!date}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="committee">Committee admins</SelectItem>
                  <SelectItem value="committee_and_staff">Committee + staff with document access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-sm font-medium">Reminder history</p>
            {history.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : history.isError ? <p className="text-xs text-destructive">Couldn't load history.</p> : !(history.data ?? []).length ? (
              <p className="text-xs text-muted-foreground">No reminders sent yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {history.data!.map((h) => (
                  <li key={h.id} className="rounded-lg bg-muted px-3 py-1.5">
                    {h.threshold === "expired" ? "Expired notice" : `${h.threshold.slice(1)}-day reminder`} · sent {new Date(h.sent_at).toLocaleDateString("en-IN")} to {h.recipients} {h.recipients === 1 ? "person" : "people"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={save.isPending || (!!date && !days.length)} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
