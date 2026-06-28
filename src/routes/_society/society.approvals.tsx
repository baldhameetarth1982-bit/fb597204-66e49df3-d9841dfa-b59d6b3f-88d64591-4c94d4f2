import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, Inbox, User, DoorOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/approvals")({
  head: () => ({ meta: [{ title: "Resident approvals — SocioHub" }] }),
  component: ApprovalsPage,
});

type Row = {
  id: string;
  user_id: string;
  flat_id: string;
  relationship: string;
  status: string;
  created_at: string;
  reason: string | null;
  // joined
  full_name?: string | null;
  email?: string | null;
  flat_number?: string | null;
  block_name?: string | null;
};

function ApprovalsPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [rejectFor, setRejectFor] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["join-requests", societyId],
    queryFn: async () => {
      const { data: reqs, error } = await supabase
        .from("join_requests" as any)
        .select("*")
        .eq("society_id", societyId!)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const list = (reqs ?? []) as any[];
      if (!list.length) return [] as Row[];
      const userIds = [...new Set(list.map((r) => r.user_id))];
      const flatIds = [...new Set(list.map((r) => r.flat_id))];
      const [{ data: profiles }, { data: flats }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").in("id", userIds),
        supabase
          .from("flats")
          .select("id, flat_number, block_id, blocks(name)")
          .in("id", flatIds),
      ]);
      const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const flatMap = new Map((flats ?? []).map((f: any) => [f.id, f]));
      return list.map((r) => ({
        ...r,
        full_name: profMap.get(r.user_id)?.full_name ?? null,
        email: profMap.get(r.user_id)?.email ?? null,
        flat_number: flatMap.get(r.flat_id)?.flat_number ?? null,
        block_name: flatMap.get(r.flat_id)?.blocks?.name ?? null,
      })) as Row[];
    },
  });

  async function approve(r: Row) {
    setBusy(r.id);
    const { error } = await supabase.rpc("respond_join_request", {
      _request_id: r.id, _approve: true,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${r.full_name ?? "Resident"} approved`);
    qc.invalidateQueries({ queryKey: ["join-requests"] });
  }

  async function reject() {
    if (!rejectFor) return;
    if (!reason.trim()) { toast.error("Please add a reason"); return; }
    setBusy(rejectFor.id);
    const { error } = await supabase.rpc("respond_join_request", {
      _request_id: rejectFor.id, _approve: false, _reason: reason.trim(),
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Request rejected");
    setRejectFor(null);
    setReason("");
    qc.invalidateQueries({ queryKey: ["join-requests"] });
  }

  return (
    <div className="px-4 pt-4 pb-8 max-w-3xl mx-auto space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resident approvals</h1>
          <p className="text-xs text-muted-foreground">Review and approve people who requested to join your society.</p>
        </div>
        <Badge variant="secondary" className="rounded-full">{rows?.length ?? 0} pending</Badge>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !rows || rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Inbox className="h-10 w-10 mx-auto mb-3" />
            No pending requests. New requests will appear here.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="rounded-2xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                      <User className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{r.full_name ?? "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.email ?? "—"}</p>
                    </div>
                    <Badge className="capitalize">{r.relationship}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <DoorOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{r.block_name ?? "—"} · {r.flat_number}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => approve(r)}
                      disabled={busy === r.id}
                      className="flex-1 h-11 rounded-xl"
                    >
                      {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Approve</>}
                    </Button>
                    <Button
                      onClick={() => { setRejectFor(r); setReason(""); }}
                      variant="outline"
                      className="flex-1 h-11 rounded-xl"
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Reject join request</SheetTitle>
          </SheetHeader>
          <div className="py-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell {rejectFor?.full_name ?? "this resident"} why their request was rejected.
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. Wrong flat — please request flat 502."
              className="rounded-2xl"
            />
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button variant="outline" onClick={() => setRejectFor(null)} className="flex-1 h-11 rounded-xl">Cancel</Button>
            <Button onClick={reject} disabled={!reason.trim() || busy === rejectFor?.id} className="flex-1 h-11 rounded-xl">
              {busy === rejectFor?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject request
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
