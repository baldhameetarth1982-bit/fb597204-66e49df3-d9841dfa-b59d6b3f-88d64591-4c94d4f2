import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Users } from "lucide-react";
import { ListSkeleton } from "@/components/people/PeopleUI";
import { cn } from "@/lib/utils";
import { govRpc, RESOLUTION_STATUS, type Quorum } from "@/lib/governance";

export type AgendaItem = { id: string; seq: number; title: string; description: string | null; kind: string; poll_id: string | null; election_id: string | null; source_id: string | null };
export type Resolution = { id: string; seq: number; title: string; body: string; status: string; agenda_item_id: string | null; poll_id: string | null; decided_at: string | null };
export type MinutesVersion = { id: string; version: number; body: string; status: string; correction_reason: string | null; published_at: string | null; created_at: string };

export const AGENDA_KIND: Record<string, string> = { discussion: "Discussion", resolution: "Resolution", vote: "Formal vote", election: "Election" };

/** Server-calculated quorum. The browser never decides whether quorum is met. */
export function QuorumPanel({ agmId }: { agmId: string }) {
  const q = useQuery({ queryKey: ["agm-quorum", agmId], queryFn: () => govRpc<Quorum>("agm_quorum", { _agm: agmId }), staleTime: 10_000 });
  if (q.isLoading) return <ListSkeleton rows={1} />;
  if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">Quorum isn't available right now.</p>;
  const d = q.data;
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border p-3", d.met ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")}>
      {d.met ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden /> : <XCircle className="h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />}
      <div className="min-w-0 text-sm">
        <p className="font-medium">{d.met ? "Quorum met" : "Quorum not met"}{d.frozen ? " (final)" : ""}{d.corrected ? " · corrected" : ""}</p>
        <p className="tabular-nums text-muted-foreground"><Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />{d.present} present of {d.eligible} {d.basis === "home" ? "homes" : "residents"} · {d.required} needed</p>
      </div>
    </div>
  );
}

export function AgendaList({ items }: { items: AgendaItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No agenda items yet.</p>;
  return (
    <ol className="space-y-2">
      {items.map((i, idx) => (
        <li key={i.id} className="rounded-xl bg-muted/40 p-3 text-sm">
          <p className="font-medium">{idx + 1}. {i.title} <span className="text-xs font-normal text-muted-foreground">· {AGENDA_KIND[i.kind]}</span></p>
          {i.description && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{i.description}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ResolutionList({ items, agenda }: { items: Resolution[]; agenda: AgendaItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No resolutions recorded.</p>;
  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.id} className="rounded-xl border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">R{r.seq}. {r.title}</p>
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", RESOLUTION_STATUS[r.status]?.className)}>{RESOLUTION_STATUS[r.status]?.label}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
          {r.agenda_item_id && <p className="mt-1 text-xs text-muted-foreground">Agenda: {agenda.find((a) => a.id === r.agenda_item_id)?.title ?? "—"}</p>}
          {r.poll_id && <p className="text-xs text-muted-foreground">Decided by a linked formal vote</p>}
        </li>
      ))}
    </ul>
  );
}
