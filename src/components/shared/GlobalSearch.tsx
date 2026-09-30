import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Search, Loader2, User, Home, FileText, Bell, UserCheck, Car, LifeBuoy, Wallet,
  CalendarDays, FolderOpen, Truck, Wrench, ShoppingCart,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Scope = "society" | "resident";
type Hit = { kind: string; id: string; title: string; subtitle: string | null; link: string };

const META: Record<string, { label: string; icon: typeof User }> = {
  flat: { label: "Flats", icon: Home },
  resident: { label: "Residents", icon: User },
  vehicle: { label: "Vehicles", icon: Car },
  visitor: { label: "Visitors", icon: UserCheck },
  ticket: { label: "Helpdesk", icon: LifeBuoy },
  bill: { label: "Bills", icon: FileText },
  payment: { label: "Payments", icon: Wallet },
  notice: { label: "Notices", icon: Bell },
  meeting: { label: "Meetings", icon: CalendarDays },
  document: { label: "Documents", icon: FolderOpen },
  vendor: { label: "Vendors", icon: Truck },
  asset: { label: "Assets", icon: Wrench },
  purchase: { label: "Purchases", icon: ShoppingCart },
};

/**
 * Unified search. Results come only from the server `global_search` RPC, which derives the
 * society and role from the signed-in user and applies RLS — the props are display hints only.
 */
export function GlobalSearch({ scope }: { societyId: string; scope: Scope }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim().slice(0, 80)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const res = useQuery({
    queryKey: ["global-search", debounced],
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("global_search", { _q: debounced, _limit: 5 });
      if (error) throw error;
      return (data ?? []) as Hit[];
    },
  });

  const grouped = useMemo(() => {
    const g: Record<string, Hit[]> = {};
    for (const h of res.data ?? []) (g[h.kind] ||= []).push(h);
    return g;
  }, [res.data]);

  const active = debounced.length >= 2;
  const busy = active && res.isFetching;
  const hits = active ? res.data ?? [] : [];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={scope === "society" ? "Search flats, residents, bills, requests, documents…" : "Search your bills, requests, notices, documents…"}
          className="pl-9 h-11"
          aria-label="Search"
          maxLength={80}
          autoFocus
        />
        {busy && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {active && !busy ? `${hits.length} results` : ""}
      </p>

      {active && res.isError && (
        <p className="text-sm text-destructive text-center py-6">Search isn't available right now. Please try again.</p>
      )}
      {active && !res.isError && !busy && hits.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No results for "{debounced}"</p>
      )}

      {Object.entries(grouped).map(([kind, list]) => {
        const m = META[kind] ?? { label: kind, icon: Search };
        const Icon = m.icon;
        return (
          <div key={kind}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {m.label} <Badge variant="secondary" className="ml-1">{list.length}</Badge>
            </div>
            <div className="space-y-1.5">
              {list.map((h) => (
                <Link key={`${kind}-${h.id}`} to={h.link} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card className="hover:bg-accent transition-colors">
                    <CardContent className="p-3 min-h-11 flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{h.title}</div>
                        {h.subtitle && <div className="text-xs text-muted-foreground truncate">{h.subtitle}</div>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
