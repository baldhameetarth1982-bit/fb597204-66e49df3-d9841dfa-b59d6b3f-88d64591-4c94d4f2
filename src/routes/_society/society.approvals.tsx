import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, XCircle, Inbox, User, Phone, DoorOpen, CheckSquare, Square,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";
import {
  listPendingJoinRequests,
  bulkApproveJoinRequests,
  bulkRejectJoinRequests,
  type PendingJoinRequest,
} from "@/lib/join-approvals";

export const Route = createFileRoute("/_society/society/approvals")({
  head: () => ({ meta: [{ title: "Resident approvals — SocioHub" }] }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectFor, setRejectFor] = useState<PendingJoinRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["join-requests-v2", societyId],
    queryFn: () => listPendingJoinRequests(societyId!),
  });

  const allSelected = useMemo(
    () => Boolean(rows?.length) && rows!.every((r) => selected.has(r.id)),
    [rows, selected],
  );

  function toggleAll() {
    if (!rows) return;
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function approveOne(r: PendingJoinRequest) {
    setBusy(r.id);
    const { error } = await supabase.rpc("respond_join_request", {
      _request_id: r.id,
      _approve: true,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${r.full_name ?? "Resident"} approved`);
    qc.invalidateQueries({ queryKey: ["join-requests-v2"] });
  }

  async function bulkApprove(all: boolean) {
    if (!societyId) return;
    const ids = all ? null : Array.from(selected);
    if (!all && ids!.length === 0) {
      toast.error("Select at least one request");
      return;
    }
    setBusy(all ? "__all__" : "__sel__");
    try {
      const n = await bulkApproveJoinRequests(societyId, ids);
      toast.success(`${n} approved`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["join-requests-v2"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function bulkReject() {
    if (!societyId || selected.size === 0) return;
    setBusy("__reject__");
    try {
      const n = await bulkRejectJoinRequests(societyId, Array.from(selected), reason.trim() || null);
      toast.success(`${n} rejected`);
      setSelected(new Set());
      setRejectFor(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["join-requests-v2"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function rejectOne() {
    if (!rejectFor) return;
    if (!reason.trim()) {
      toast.error("Please add a reason");
      return;
    }
    setBusy(rejectFor.id);
    const { error } = await supabase.rpc("respond_join_request", {
      _request_id: rejectFor.id,
      _approve: false,
      _reason: reason.trim(),
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Request rejected");
    setRejectFor(null);
    setReason("");
    qc.invalidateQueries({ queryKey: ["join-requests-v2"] });
  }

  return (
    <div className="px-4 pt-4 pb-8 max-w-3xl mx-auto space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resident approvals</h1>
          <p className="text-xs text-muted-foreground">
            Review and approve residents who requested to join your society.
          </p>
        </div>
        <Badge variant="secondary" className="rounded-full">
          {rows?.length ?? 0} pending
        </Badge>
      </header>

      {rows && rows.length > 0 && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/80 backdrop-blur border-b border-border flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allSelected ? "Unselect all" : "Select all"}
          </button>
          <span className="text-xs text-muted-foreground ml-2">
            {selected.size ? `${selected.size} selected` : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl h-9"
              disabled={selected.size === 0 || busy !== null}
              onClick={() => setRejectFor({ id: "__bulk__" } as any)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl h-9"
              disabled={selected.size === 0 || busy !== null}
              onClick={() => bulkApprove(false)}
            >
              {busy === "__sel__" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Approve selected
            </Button>
            <Button
              size="sm"
              className="rounded-xl h-9"
              disabled={busy !== null}
              onClick={() => bulkApprove(true)}
            >
              {busy === "__all__" && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Approve all
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
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
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggleRow(r.id)}
                      aria-label="Select request"
                      className="mt-1"
                    />
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <User className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{r.full_name ?? "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.requester_email ?? "—"}</p>
                    </div>
                    <Badge className="capitalize">{r.owner_or_tenant ?? "resident"}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <DoorOpen className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{r.flat_number_input ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground truncate">{r.mobile ?? "—"}</span>
                    </div>
                    <div className="col-span-2 text-[11px] text-muted-foreground">
                      Requested {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => approveOne(r)}
                      disabled={busy === r.id}
                      className="flex-1 h-11 rounded-xl"
                    >
                      {busy === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        setRejectFor(r);
                        setReason("");
                      }}
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
            <SheetTitle>
              {rejectFor?.id === "__bulk__"
                ? `Reject ${selected.size} request${selected.size === 1 ? "" : "s"}`
                : "Reject join request"}
            </SheetTitle>
          </SheetHeader>
          <div className="py-3 space-y-3">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Reason (shown to the resident)"
              className="rounded-2xl"
            />
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setRejectFor(null)}
              className="flex-1 h-11 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={rejectFor?.id === "__bulk__" ? bulkReject : rejectOne}
              disabled={busy !== null}
              className="flex-1 h-11 rounded-xl"
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
