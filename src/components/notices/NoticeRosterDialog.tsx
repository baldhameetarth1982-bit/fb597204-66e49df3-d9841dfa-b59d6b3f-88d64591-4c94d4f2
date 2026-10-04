// Committee-only: who in the notice's audience has opened / acknowledged it. Server checks society + permission.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { neutralizeFormula } from "@/lib/migration-pipeline";
import { cn } from "@/lib/utils";

type Row = { full_name: string | null; homes: string | null; opened_at: string | null; acked_at: string | null };
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

function download(title: string, rows: Row[], ack: boolean) {
  const esc = (v: string) => `"${neutralizeFormula(v).replace(/"/g, '""')}"`;
  const head = ["Name", "Home", "Opened", ...(ack ? ["Acknowledged"] : [])];
  const lines = rows.map((r) => [r.full_name ?? "", r.homes ?? "", fmt(r.opened_at), ...(ack ? [fmt(r.acked_at)] : [])].map(esc).join(","));
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "notice"}-readers.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function NoticeRosterDialog({ noticeId, title, requiresAck }: { noticeId: string; title: string; requiresAck: boolean }) {
  const [open, setOpen] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const q = useQuery({
    queryKey: ["notice-roster", noticeId],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_notice_ack_roster", { _notice_id: noticeId });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const done = (r: Row) => (requiresAck ? !!r.acked_at : !!r.opened_at);
  const rows = (q.data ?? []).filter((r) => !pendingOnly || !done(r));
  const pending = (q.data ?? []).filter((r) => !done(r)).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 rounded-xl"><Users className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">Readers</span><span className="sr-only md:hidden">Readers of {title}</span></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{requiresAck ? "Acknowledgements" : "Who opened it"}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{title}</p>
        {q.isPending ? (
          <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : q.isError ? (
          <div role="alert" className="space-y-2 text-sm"><p>Couldn't load the list.</p><Button variant="outline" className="min-h-11" onClick={() => q.refetch()}>Try again</Button></div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant={pendingOnly ? "default" : "outline"} className="min-h-11 rounded-xl" onClick={() => setPendingOnly((v) => !v)}>
                {requiresAck ? "Not acknowledged" : "Not opened"} ({pending})
              </Button>
              <Button variant="outline" className="min-h-11 rounded-xl" disabled={!q.data.length} onClick={() => download(title, q.data, requiresAck)}>
                <Download className="mr-1 h-4 w-4" />Download list
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{pendingOnly ? "Everyone is done." : "No current residents in this notice's audience."}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.full_name || "Resident"}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.homes || "—"}</p>
                    </div>
                    <span className={cn("shrink-0 text-xs", done(r) ? "text-success" : "text-muted-foreground")}>
                      {done(r) ? (requiresAck ? `Acknowledged ${fmt(r.acked_at)}` : `Opened ${fmt(r.opened_at)}`) : r.opened_at ? "Opened, not acknowledged" : "Not opened"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
