// Committee-only: earlier wording of a published notice, kept automatically whenever it is edited.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { tu } from "@/lib/i18n";

type Version = { id: string; title: string; body: string; replaced_at: string };
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function NoticeVersionsDialog({ noticeId, title }: { noticeId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["notice-versions", noticeId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notice_versions")
        .select("id, title, body, replaced_at")
        .eq("notice_id", noticeId)
        .order("replaced_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Version[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-11 rounded-xl text-muted-foreground" aria-label={`Earlier versions of ${title}`}>
          <History className="h-4 w-4 md:mr-1" /><span className="hidden md:inline">{tu("billingTabs.history")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{tu("op.earlier_versions")}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{tu("op.what_this_notice_said_before")}</p>
        {q.isLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" aria-label={tu("op.loading")} /></div>}
        {q.isError && <p className="text-sm text-destructive">{tu("op.couldn_t_load_earlier_versions")}</p>}
        {q.data && q.data.length === 0 && <p className="text-sm text-muted-foreground">{tu("op.no_earlier_versions_edits_made")}</p>}
        <ol className="space-y-3">
          {q.data?.map((v) => (
            <li key={v.id} className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">{tu("op.replaced")} {fmt(v.replaced_at)}</p>
              <p className="mt-1 font-medium">{v.title}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{v.body}</p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
