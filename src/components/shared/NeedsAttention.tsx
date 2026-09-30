import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Item = { key: string; priority: number; reason: string; item_count: number; link: string };

/**
 * Deterministic "Needs attention" list from the server `get_needs_attention` RPC.
 * Counts come straight from canonical records under the caller's role; no AI, no cached counters.
 */
export function NeedsAttention({ max = 6, exclude = [], emptyText = "{emptyText}" }: { max?: number; exclude?: string[]; emptyText?: string }) {
  const q = useQuery({
    queryKey: ["needs-attention"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_needs_attention");
      if (error) throw error;
      return ((data ?? []) as Item[]).sort((a, b) => a.priority - b.priority);
    },
  });

  if (q.isLoading) {
    return <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />)}</div>;
  }
  if (q.isError) {
    return <p className="text-sm text-muted-foreground">Couldn't load items that need attention. Pull to refresh or try again.</p>;
  }
  const items = (q.data ?? []).filter((i) => !exclude.includes(i.key));
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> {emptyText}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.slice(0, max).map((it) => (
        <li key={it.key}>
          <Link
            to={it.link}
            className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AlertTriangle className={`h-4 w-4 shrink-0 ${it.priority <= 2 ? "text-destructive" : "text-muted-foreground"}`} aria-hidden />
            <span className="flex-1 text-sm">{it.reason}</span>
            {it.priority <= 2 && <span className="sr-only">High priority</span>}
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
