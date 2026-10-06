import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tu } from "@/lib/i18n";

type G = { id: string; name: string; description: string | null; kind: string; join_policy: string; status: string };
const KINDS = ["interest", "club", "sports", "hobby", "committee", "other"] as const;

export function GroupsBoard({ societyId, mode }: { societyId: string; mode: "admin" | "resident" }) {
  const qc = useQueryClient();
  const key = ["community-groups", societyId, mode];
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      let sel = supabase.from("community_groups").select("id,name,description,kind,join_policy,status").eq("society_id", societyId).order("name").limit(300);
      if (mode === "resident") sel = sel.eq("status", "active");
      const { data: gs, error } = await sel;
      if (error) throw error;
      const ids = (gs ?? []).map((g) => g.id);
      const [c, mem] = await Promise.all([
        ids.length ? supabase.rpc("group_counts", { _ids: ids }) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("community_group_members").select("group_id,user_id,status").in("group_id", ids).limit(5000) : Promise.resolve({ data: [], error: null }),
      ]);
      if (c.error) throw c.error; if (mem.error) throw mem.error;
      const rows = (mem.data ?? []) as { group_id: string; user_id: string; status: string }[];
      const pendingIds = mode === "admin" ? [...new Set(rows.filter((r) => r.status === "pending").map((r) => r.user_id))] : [];
      const names = new Map<string, string>();
      if (pendingIds.length) {
        const { data: p } = await supabase.from("profiles").select("id,full_name").in("id", pendingIds);
        for (const r of p ?? []) names.set(r.id, r.full_name ?? "Resident");
      }
      const { data: u } = await supabase.auth.getUser();
      return {
        gs: gs as G[],
        counts: new Map((c.data ?? []).map((r: { group_id: string; members: number; pending: number }) => [r.group_id, r])),
        mine: new Map(rows.filter((r) => r.user_id === u.user?.id).map((r) => [r.group_id, r.status])),
        pending: rows.filter((r) => r.status === "pending"),
        names,
      };
    },
  });

  async function call(id: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    if (busy) return; setBusy(id);
    const { error } = await fn();
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(ok); qc.invalidateQueries({ queryKey: ["community-groups", societyId] });
  }

  return (
    <div>
      {mode === "admin" && <div className="mb-4 flex justify-end"><Button className="min-h-11" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />{tu("op.new_group")}</Button></div>}
      {q.isLoading ? <p className="text-muted-foreground">{tu("op.loading_groups")}</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>{tu("op.couldn_t_load_groups")}</p><Button variant="outline" className="mt-2" onClick={() => q.refetch()}>{tu("common.tryAgain")}</Button></div>
        : q.data!.gs.length === 0 ? <div className="rounded-lg border p-8 text-center text-muted-foreground"><Users className="mx-auto mb-2 h-6 w-6" />{tu("op.no_groups_yet")}</div>
        : (
          <ul className="space-y-3">
            {q.data!.gs.map((g) => {
              const c = q.data!.counts.get(g.id); const mine = q.data!.mine.get(g.id);
              const pend = q.data!.pending.filter((p) => p.group_id === g.id);
              const archived = g.status === "archived";
              return (
                <li key={g.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{g.name}{g.join_policy === "approval" && <Lock className="ml-1 inline h-3 w-3" aria-label={tu("op.needs_approval")} />}{archived && <span className="ml-2 text-sm text-muted-foreground">{tu("cm.st.archived")}</span>}</p>
                      <p className="text-sm capitalize text-muted-foreground">{g.kind} · {c?.members ?? 0} {tu("op.members")}{mode === "admin" && c?.pending ? ` · ${c.pending} waiting` : ""}</p>
                      {g.description && <p className="mt-1 text-sm">{g.description}</p>}
                    </div>
                    {mode === "resident" && (mine
                      ? <Button variant="outline" className="min-h-11" disabled={busy === g.id} onClick={() => call(g.id, () => supabase.rpc("group_membership", { _group_id: g.id, _join: false }), mine === "pending" ? "Request withdrawn" : "Left group")}>{mine === "pending" ? tu("op.withdraw_request") : tu("op.leave")}</Button>
                      : <Button className="min-h-11" disabled={busy === g.id} onClick={() => call(g.id, () => supabase.rpc("group_membership", { _group_id: g.id, _join: true }), g.join_policy === "open" ? "Joined" : "Request sent")}>{g.join_policy === "open" ? tu("op.join") : tu("op.ask_to_join")}</Button>)}
                    {mode === "admin" && !archived && <Button variant="outline" className="min-h-11" disabled={busy === g.id} onClick={() => call(g.id, () => supabase.rpc("admin_group_action", { _group_id: g.id, _action: "archive" }), "Group archived")}>{tu("cm.archive")}</Button>}
                  </div>
                  {mine === "pending" && <p className="mt-2 text-sm text-muted-foreground">{tu("op.waiting_for_committee_approval")}</p>}
                  {mode === "admin" && pend.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t pt-3">
                      {pend.map((p) => (
                        <li key={p.user_id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="flex-1">{q.data!.names.get(p.user_id) ?? tu("inc.k.resident")} {tu("op.wants_to_join")}</span>
                          <Button size="sm" className="min-h-11" onClick={() => call(g.id + p.user_id, () => supabase.rpc("admin_group_action", { _group_id: g.id, _action: "approve", _user_id: p.user_id }), "Approved")}>{tu("vs.approve")}</Button>
                          <Button size="sm" variant="outline" className="min-h-11" onClick={() => call(g.id + p.user_id, () => supabase.rpc("admin_group_action", { _group_id: g.id, _action: "reject", _user_id: p.user_id }), "Declined")}>{tu("op.decline")}</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      {creating && <CreateGroup societyId={societyId} onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ["community-groups", societyId] })} />}
    </div>
  );
}

function CreateGroup({ societyId, onClose, onDone }: { societyId: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [kind, setKind] = useState("interest"); const [policy, setPolicy] = useState("open"); const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 3 || busy) return toast.error(tu("op.name_needs_at_least_3"));
    setBusy(true);
    const { error } = await supabase.rpc("admin_save_group", { _society_id: societyId, _name: name, _description: desc, _kind: kind, _join_policy: policy });
    setBusy(false);
    if (error) return toast.error(error.message.includes("community_groups_name") ? "A group with this name already exists" : error.message);
    toast.success(tu("op.group_created")); onDone(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{tu("op.new_group")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="gn">{tu("common.name")}</Label><Input id="gn" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="gk">{tu("cm.type")}</Label><select id="gk" className="mt-1 h-11 w-full rounded-md border bg-background px-2 capitalize" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
            <div><Label htmlFor="gp">{tu("op.joining")}</Label><select id="gp" className="mt-1 h-11 w-full rounded-md border bg-background px-2" value={policy} onChange={(e) => setPolicy(e.target.value)}><option value="open">{tu("op.anyone_can_join")}</option><option value="approval">{tu("op.committee_approves")}</option></select></div>
          </div>
          <div><Label htmlFor="gd">{tu("common.description")}</Label><Textarea id="gd" maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{tu("common.close")}</Button><Button disabled={busy} onClick={save}>{busy ? tu("cm.saving") : tu("common.create")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
