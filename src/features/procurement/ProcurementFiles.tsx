import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { listProcurementEvidence, uploadProcurementEvidence } from "@/lib/procurement-evidence.functions";
import { tu } from "@/lib/i18n";

const MAX = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
export type EvidenceRow = Awaited<ReturnType<typeof listProcurementEvidence>>[number];

export function fileErrorMessage(err: unknown): string {
  const m = (err as { message?: string } | null)?.message ?? "";
  if (m.includes("invalid_file")) return "Use a PDF, JPG, PNG or WebP file up to 5 MB.";
  if (m.includes("locked")) return "Files can't be changed at this stage.";
  if (m.includes("too_many_files")) return "Up to 5 files are allowed here.";
  if (m.includes("rate_limited")) return "Too many uploads. Try again later.";
  if (m.includes("reason_required")) return "Give a reason of at least 5 characters.";
  if (m.includes("not_authorized")) return "You don't have permission for this file.";
  return "Couldn't complete that. Try again.";
}

function toBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function useProcurementEvidence(requestId: string) {
  const list = useServerFn(listProcurementEvidence);
  return useQuery({ queryKey: ["procurement", "files", requestId], queryFn: () => list({ data: { requestId } }), staleTime: 60_000 });
}

export function ProcurementFiles({ requestId, quotationId, kind, rows, editable, label }: {
  requestId: string; quotationId: string | null; kind: "quotation" | "invoice"; rows: EvidenceRow[]; editable: boolean; label: string;
}) {
  const qc = useQueryClient(); const upload = useServerFn(uploadProcurementEvidence);
  const inputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null); const [reason, setReason] = useState("");
  const mine = rows.filter((r) => r.kind === kind && (r.quotation_id ?? null) === quotationId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["procurement", "files", requestId] });

  const up = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (file: File) => {
      if (file.size > MAX || file.size < 8) throw new Error("invalid_file");
      if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) throw new Error("invalid_file");
      return upload({ data: { requestId, quotationId, kind, fileName: file.name, base64: toBase64(await file.arrayBuffer()) } });
    },
    onSuccess: () => { toast.success(tu("hd.t.fileAttached")); refresh(); },
    onError: (e) => toast.error(fileErrorMessage(e)),
    onSettled: () => { if (inputRef.current) inputRef.current.value = ""; },
  });
  const rm = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("proc_remove_attachment", { _attachment: id, _reason: reason }); if (error) throw error; },
    onSuccess: () => { toast.success(tu("op.file_removed_it_stays_in")); setRemoving(null); setReason(""); refresh(); qc.invalidateQueries({ queryKey: ["procurement", "detail", requestId] }); },
    onError: (e) => toast.error(fileErrorMessage(e)),
  });

  if (!editable && mine.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {mine.map((f) => (
        <div key={f.id} className="rounded-lg bg-muted/50 px-2 py-1.5 text-xs">
          <div className="flex min-h-9 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {f.removed_at ? (
              <span className="min-w-0 flex-1 truncate text-muted-foreground line-through" title={f.name}>{f.name}</span>
            ) : f.url ? (
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-primary underline-offset-2 hover:underline" title={f.name}>{f.name}</a>
            ) : (
              <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name} · link unavailable, reopen to refresh</span>
            )}
            <span className="shrink-0 text-muted-foreground">{f.mime === "application/pdf" ? "PDF" : tu("op.image")} · {kb(f.size)}</span>
            {editable && !f.removed_at && removing !== f.id && (
              <Button type="button" size="sm" variant="ghost" className="min-h-9 shrink-0" onClick={() => { setRemoving(f.id); setReason(""); }}>{tu("fd.remove")}</Button>
            )}
          </div>
          {f.removed_at && <p className="pl-6 text-muted-foreground">{tu("op.removed")} {f.remove_reason}</p>}
          {removing === f.id && (
            <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); rm.mutate(f.id); }}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tu("op.reason_for_removing")} aria-label={tu("op.reason_for_removing")} maxLength={300} className="min-h-9 text-xs" />
              <Button type="submit" size="sm" variant="destructive" className="min-h-9" disabled={rm.isPending || reason.trim().length < 5}>{tu("fd.remove")}</Button>
              <Button type="button" size="sm" variant="ghost" className="min-h-9" onClick={() => setRemoving(null)}>{tu("common.cancel")}</Button>
            </form>
          )}
        </div>
      ))}
      {editable && (
        <>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label={label}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); }} />
          <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={up.isPending} onClick={() => inputRef.current?.click()}>
            {up.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Paperclip className="mr-1 h-4 w-4" aria-hidden />}
            {up.isPending ? tu("op.uploading") : label}
          </Button>
          <p className="text-[11px] text-muted-foreground">{tu("op.pdf_jpg_png_or_webp")}</p>
        </>
      )}
    </div>
  );
}
