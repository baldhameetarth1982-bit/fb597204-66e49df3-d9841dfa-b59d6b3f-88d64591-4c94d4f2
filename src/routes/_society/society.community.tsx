import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flag, RotateCcw, ShieldX, Store, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ListEmpty, ListSkeleton, LoadError, StatusChip } from "@/components/people/PeopleUI";
import { listModerationQueue } from "@/lib/community.functions";
import { communityError } from "@/lib/community-errors";

export const Route = createFileRoute("/_society/society/community")({
  head: () => ({
    meta: [
      { title: "Community moderation — SociyoHub" },
      { name: "description", content: "Review reported resident listings and manage marketplace categories." },
      { property: "og:title", content: "Community moderation — SociyoHub" },
      { property: "og:description", content: "Keep the resident marketplace safe and on-topic." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunityModeration,
});

function CommunityModeration() {
  const qc = useQueryClient();
  const fetchQueue = useServerFn(listModerationQueue);
  const q = useQuery({ queryKey: ["community-moderation"], queryFn: () => fetchQueue(), staleTime: 15_000 });
  const [filter, setFilter] = useState<"reported" | "all" | "removed">("reported");
  const [removing, setRemoving] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const moderate = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string; action: string; reason?: string }) => {
      const { error } = await (supabase as any).rpc("market_moderate", { _id: v.id, _action: v.action, _reason: v.reason ?? null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Done — the owner has been notified where relevant"); setRemoving(null); setReason(""); qc.invalidateQueries({ queryKey: ["community-moderation"] }); },
    onError: (e) => toast.error(communityError(e)),
  });

  const listings = q.data?.listings ?? [];
  const reports = q.data?.reports ?? [];
  const shown = listings.filter((l: any) => filter === "all" ? true : filter === "removed" ? l.status === "removed" : l.report_count > 0 && l.status !== "removed");

  return (
    <PageShell>
      <PageHeader title="Community marketplace" description="Resident listings in your society. Remove anything unsafe — owners see your reason." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(["reported", "all", "removed"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} className="min-h-11 capitalize" onClick={() => setFilter(f)}>
            {f}{f === "reported" ? ` (${listings.filter((l: any) => l.report_count > 0 && l.status !== "removed").length})` : ""}
          </Button>
        ))}
      </div>
      {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? <LoadError title="Couldn't load listings" onRetry={() => void q.refetch()} /> : !shown.length ? (
        <ListEmpty icon={Store} title={filter === "reported" ? "Nothing reported" : "No listings"}>Reported listings will appear here.</ListEmpty>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {shown.map((l: any) => (
            <li key={l.id} className="flex gap-3 p-4">
              {l.image_url && <img src={l.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  <StatusChip tone={l.status === "removed" ? "warning" : l.status === "published" ? "success" : "muted"}>{l.status}</StatusChip>
                  {l.report_count > 0 && <StatusChip tone="warning"><Flag className="mr-1 h-3 w-3" />{l.report_count} report{l.report_count > 1 ? "s" : ""}</StatusChip>}
                </div>
                <p className="font-medium break-words">{l.title}</p>
                {l.description && <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>}
                {reports.filter((r) => r.listing_id === l.id).map((r) => <p key={r.id} className="rounded-lg bg-muted px-3 py-1.5 text-xs">“{r.reason}”</p>)}
                {l.removed_reason && <p className="text-xs text-muted-foreground">Removed: {l.removed_reason}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {l.status !== "removed" && <Button size="sm" variant="destructive" className="min-h-11" onClick={() => setRemoving(l)}><ShieldX className="mr-1 h-4 w-4" />Remove</Button>}
                  {l.status !== "removed" && l.report_count > 0 && <Button size="sm" variant="outline" className="min-h-11" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: l.id, action: "dismiss_reports" })}><Check className="mr-1 h-4 w-4" />Dismiss reports</Button>}
                  {l.status === "removed" && <Button size="sm" variant="outline" className="min-h-11" disabled={moderate.isPending} onClick={() => moderate.mutate({ id: l.id, action: "restore" })}><RotateCcw className="mr-1 h-4 w-4" />Restore</Button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Categories />
      {removing && (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Remove listing</DialogTitle><DialogDescription>The owner is notified with this reason. It is kept in the listing history.</DialogDescription></DialogHeader>
            <Label htmlFor="r">Reason</Label>
            <Textarea id="r" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" className="min-h-11" onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="destructive" className="min-h-11" disabled={reason.trim().length < 3 || moderate.isPending} onClick={() => moderate.mutate({ id: removing.id, action: "remove", reason: reason.trim() })}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}

function Categories() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const q = useQuery({
    queryKey: ["community-categories-admin"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("community_listing_categories").select("id,label,active,society_id").order("sort_order");
      if (error) throw error;
      return data as { id: string; label: string; active: boolean; society_id: string | null }[];
    },
  });
  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string | null; label: string; active: boolean | null }) => {
      const { error } = await (supabase as any).rpc("market_set_category", { _id: v.id, _label: v.label, _active: v.active });
      if (error) throw error;
    },
    onSuccess: () => { setLabel(""); qc.invalidateQueries({ queryKey: ["community-categories-admin"] }); qc.invalidateQueries({ queryKey: ["community-categories"] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-semibold">Categories</h2>
      <p className="text-sm text-muted-foreground">Default categories are shared; add your own for this society.</p>
      <div className="flex flex-wrap gap-2">
        {(q.data ?? []).map((c) => (
          <span key={c.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
            {c.label}{!c.active && " (hidden)"}
            {c.society_id && <button type="button" className="min-h-8 text-xs text-primary underline" onClick={() => save.mutate({ id: c.id, label: c.label, active: !c.active })}>{c.active ? "Hide" : "Show"}</button>}
          </span>
        ))}
      </div>
      <div className="flex max-w-md gap-2">
        <Input aria-label="New category" className="min-h-11" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Home-cooked food" />
        <Button className="min-h-11" disabled={label.trim().length < 2 || /[<>{}]/.test(label) || save.isPending} onClick={() => save.mutate({ id: null, label: label.trim(), active: true })}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
    </section>
  );
}
