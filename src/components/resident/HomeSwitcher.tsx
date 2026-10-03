import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Home, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type MyHome = {
  flat_id: string; flat_number: string | null; block_name: string | null;
  society_id: string; society_name: string; relationship: string; is_active_home: boolean;
};

/** The server lists only this person's current, valid homes. */
export function useMyHomes() {
  return useQuery({
    queryKey: ["my-homes"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_my_homes");
      if (error) throw error;
      return (data ?? []) as MyHome[];
    },
  });
}

/** Server-resolved selected home in the current society (null = no current home). */
export async function fetchCurrentHomeId(): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("current_home_flat_id");
  if (error) throw error;
  return (data as string | null) ?? null;
}

const label = (h: MyHome) => [h.block_name, h.flat_number].filter(Boolean).join(" · ") || "Home";

/** Shown only when the person has more than one active home. */
export function HomeSwitcher() {
  const qc = useQueryClient();
  const { data: homes } = useMyHomes();
  const [switching, setSwitching] = useState<string | null>(null);
  if (!homes || homes.length < 2) return null;
  const active = homes.find((h) => h.is_active_home) ?? homes[0];
  const multiSociety = new Set(homes.map((h) => h.society_id)).size > 1;

  async function choose(h: MyHome) {
    if (switching || h.is_active_home) return;
    setSwitching(h.flat_id);
    const { error } = await (supabase as any).rpc("switch_active_home", { _flat_id: h.flat_id });
    if (error) {
      setSwitching(null);
      toast.error("Couldn't switch home. You're still viewing your current home.");
      return;
    }
    // Drop every cached record from the previous home, then reload into the new context.
    qc.clear();
    window.location.assign("/app/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-h-11 w-full justify-start gap-2 rounded-xl" disabled={!!switching} aria-label={`Current home: ${label(active)}. Switch home`}>
            {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Home className="h-4 w-4 text-primary" />}
            <span className="min-w-0 flex-1 truncate text-left">
              <span className="font-medium">{label(active)}</span>
              {multiSociety && <span className="text-muted-foreground"> · {active.society_name}</span>}
            </span>
            <span className="text-xs text-muted-foreground">Switch</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(92vw,22rem)]">
          <DropdownMenuLabel>Your homes</DropdownMenuLabel>
          {homes.map((h) => (
            <DropdownMenuItem key={h.flat_id} className="min-h-11 gap-2" disabled={!!switching} onSelect={() => void choose(h)}>
              {h.is_active_home ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{label(h)}</span>
                <span className="block truncate text-xs text-muted-foreground capitalize">{h.society_name} · {h.relationship}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
