// Committee-only: link staff / vendor / asset and escalate. Server re-checks society + permission.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { helpdeskErrorMessage } from "@/lib/helpdesk";

type Opt = { id: string; name: string };
export function useOpsOptions() {
  return useQuery({
    queryKey: ["ops", "options"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [s, v, a] = await Promise.all([
        supabase.from("society_staff").select("id, full_name").eq("is_active", true).order("full_name").limit(200),
        supabase.from("finance_vendors").select("id, name").eq("is_active", true).order("name").limit(200),
        supabase.from("society_assets").select("id, name").neq("status", "retired").order("name").limit(300),
      ]);
      if (s.error || v.error || a.error) throw s.error ?? v.error ?? a.error;
      return {
        staff: (s.data ?? []).map((x) => ({ id: x.id, name: x.full_name })) as Opt[],
        vendors: (v.data ?? []).map((x) => ({ id: x.id, name: x.name })) as Opt[],
        assets: (a.data ?? []).map((x) => ({ id: x.id, name: x.name })) as Opt[],
      };
    },
  });
}

interface Props { ticketId: string; staffId: string | null; vendorId: string | null; assetId: string | null; escalationLevel: number; closed: boolean }

export function TicketOpsPanel({ ticketId, staffId, vendorId, assetId, escalationLevel, closed }: Props) {
  const qc = useQueryClient();
  const opts = useOpsOptions();
  const [reason, setReason] = useState("");
  const [escOpen, setEscOpen] = useState(false);
  const link = useMutation({
    mutationFn: async (v: { staff: string | null; vendor: string | null; asset: string | null }) => {
      const { error } = await supabase.rpc("helpdesk_assign_work", {
        _ticket: ticketId, _staff: v.staff as string, _vendor: v.vendor as string, _asset: v.asset as string,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Work assignment updated"); qc.invalidateQueries({ queryKey: ["helpdesk"] }); },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });
  const esc = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("helpdesk_escalate", { _ticket: ticketId, _reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Escalated to the committee"); setReason(""); setEscOpen(false); qc.invalidateQueries({ queryKey: ["helpdesk"] }); },
    onError: (e) => toast.error(helpdeskErrorMessage(e)),
  });
  const cur = { staff: staffId, vendor: vendorId, asset: assetId };
  const pick = (key: "staff" | "vendor" | "asset", list: Opt[] | undefined, label: string) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={`ops-${key}`}>{label}</label>
      <Select value={cur[key] ?? "none"} disabled={closed || link.isPending || !opts.data}
        onValueChange={(v) => link.mutate({ ...cur, [key]: v === "none" ? null : v })}>
        <SelectTrigger id={`ops-${key}`} className="min-h-11 rounded-xl"><SelectValue placeholder="None" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {(list ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="space-y-3 rounded-2xl border p-3">
      <p className="text-sm font-medium">Work</p>
      {opts.isError ? <p className="text-xs text-destructive">Couldn't load staff, vendors and assets.</p> : (
        <div className="grid gap-2 sm:grid-cols-3">
          {pick("staff", opts.data?.staff, "Staff")}
          {pick("vendor", opts.data?.vendors, "Vendor")}
          {pick("asset", opts.data?.assets, "Asset")}
        </div>
      )}
      {!closed && escalationLevel < 3 && (escOpen ? (
        <div className="space-y-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="rounded-xl" placeholder="Why does this need escalating? (min 5 characters)" aria-label="Escalation reason" />
          <div className="flex gap-2">
            <Button variant="destructive" className="min-h-11 flex-1 rounded-xl" disabled={esc.isPending || reason.trim().length < 5} onClick={() => esc.mutate()}>
              {esc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Escalate"}
            </Button>
            <Button variant="ghost" className="min-h-11 rounded-xl" onClick={() => setEscOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="min-h-11 w-full rounded-xl" onClick={() => setEscOpen(true)}>
          <AlertTriangle className="mr-1 h-4 w-4" />{escalationLevel ? `Escalate further (level ${escalationLevel})` : "Escalate"}
        </Button>
      ))}
    </div>
  );
}
