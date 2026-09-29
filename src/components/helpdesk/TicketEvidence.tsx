import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listTicketEvidence, uploadTicketEvidence } from "@/lib/helpdesk-evidence.functions";
import { helpdeskErrorMessage } from "@/lib/helpdesk";

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("invalid_file"));
    r.readAsDataURL(file);
  });
}

export function TicketEvidence({ ticketId, canUpload }: { ticketId: string; canUpload: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listTicketEvidence);
  const upload = useServerFn(uploadTicketEvidence);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["helpdesk", "evidence", ticketId], staleTime: 60_000, queryFn: () => list({ data: { ticketId } }) });

  async function onPick(f: File | undefined) {
    if (!f || busy) return;
    if (f.size > 5 * 1024 * 1024) { toast.error(helpdeskErrorMessage("invalid_file")); return; }
    setBusy(true);
    try {
      await upload({ data: { ticketId, base64: await toBase64(f) } });
      toast.success("File attached");
      qc.invalidateQueries({ queryKey: ["helpdesk"] });
    } catch (e) { toast.error(helpdeskErrorMessage(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return (
    <section aria-label="Evidence" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Photos & files</h3>
        {canUpload && (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" id={`ev-${ticketId}`} onChange={(e) => onPick(e.target.files?.[0])} />
            <Button size="sm" variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Paperclip className="mr-1 h-4 w-4" />Attach</>}
            </Button>
          </>
        )}
      </div>
      {q.isPending ? <p className="text-xs text-muted-foreground">Loading…</p>
        : q.isError ? <p className="text-xs text-destructive">Couldn't load files.</p>
        : !q.data.length ? <p className="text-xs text-muted-foreground">No files yet.{canUpload ? " JPG, PNG, WebP or PDF up to 5 MB." : ""}</p>
        : (
          <ul className="grid grid-cols-3 gap-2">
            {q.data.map((f) => (
              <li key={f.id}>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border bg-muted">
                    {f.mime.startsWith("image/") ? <img src={f.url} alt="Attached evidence" className="h-full w-full object-cover" loading="lazy" /> : <FileText className="h-6 w-6 text-muted-foreground" aria-label="PDF file" />}
                  </a>
                ) : <span className="flex aspect-square items-center justify-center rounded-xl border text-xs text-muted-foreground">Unavailable</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
