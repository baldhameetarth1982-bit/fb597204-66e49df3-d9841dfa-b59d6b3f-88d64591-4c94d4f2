import { useEffect, useRef, useState } from "react";
import { askText } from "@/components/system/AskTextDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, RotateCw, X, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listParkingEvidence, uploadParkingEvidence } from "@/lib/parking-evidence.functions";
import { tu } from "@/lib/i18n";

export const MAX_PHOTOS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];

const MSG_KEYS = ["invalid_file", "too_many_files", "not_authorized", "locked", "rate_limited", "reason_required"] as const;
const msg = (k: (typeof MSG_KEYS)[number]) => i18n.t(`pk.e.${k}`, { n: MAX_PHOTOS }) as string;
export function evidenceError(e: unknown) {
  const m = (e as { message?: string } | null)?.message ?? "";
  for (const k of MSG_KEYS) if (m.includes(k)) return msg(k);
  return i18n.t("pk.e.upload") as string;
}

export function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("invalid_file"));
    r.readAsDataURL(file);
  });
}

export type Pending = { key: string; file: File; preview: string; state: "ready" | "uploading" | "done" | "failed"; error?: string };

/** Local photo queue: pick/capture, preview, remove before submit. */
export function usePhotoQueue() {
  const [items, setItems] = useState<Pending[]>([]);
  const ref = useRef(items); ref.current = items;
  useEffect(() => () => ref.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  function add(files: FileList | null) {
    if (!files) return;
    const next: Pending[] = [];
    for (const f of Array.from(files)) {
      if (ref.current.length + next.length >= MAX_PHOTOS) { toast.error(msg("too_many_files")); break; }
      if (!OK_TYPES.includes(f.type) || f.size > MAX_BYTES || f.size < 12) { toast.error(`${f.name}: ${msg("invalid_file")}`); continue; }
      next.push({ key: crypto.randomUUID(), file: f, preview: URL.createObjectURL(f), state: "ready" });
    }
    if (next.length) setItems((s) => [...s, ...next]);
  }
  function remove(key: string) { setItems((s) => { const p = s.find((x) => x.key === key); if (p) URL.revokeObjectURL(p.preview); return s.filter((x) => x.key !== key); }); }
  function set(key: string, patch: Partial<Pending>) { setItems((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x))); }
  function clear() { ref.current.forEach((p) => URL.revokeObjectURL(p.preview)); setItems([]); }
  return { items, add, remove, set, clear };
}

export function PhotoPicker({ q, disabled, onRetry }: { q: ReturnType<typeof usePhotoQueue>; disabled?: boolean; onRetry?: (p: Pending) => void }) {
  const { t } = useTranslation();
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const full = q.items.length >= MAX_PHOTOS;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { q.add(e.target.files); e.target.value = ""; }} />
        <input ref={lib} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { q.add(e.target.files); e.target.value = ""; }} />
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={disabled || full} onClick={() => cam.current?.click()}><Camera className="me-1 h-4 w-4" />{t("pk.takePhoto")}</Button>
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={disabled || full} onClick={() => lib.current?.click()}><ImagePlus className="me-1 h-4 w-4" />{t("pk.choosePhoto")}</Button>
      </div>
      {q.items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label={t("pk.photosToAttach")}>
          {q.items.map((p) => (
            <li key={p.key} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
              <img src={p.preview} alt={t("pk.preview")} className="h-full w-full object-cover" />
              {p.state === "uploading" && <span className="absolute inset-0 flex items-center justify-center bg-background/70"><Loader2 className="h-5 w-5 animate-spin" aria-label={t("pk.uploading")} /></span>}
              {p.state === "done" && <span className="absolute bottom-1 left-1 rounded-full bg-background/90 p-0.5"><CheckCircle2 className="h-4 w-4 text-primary" aria-label={t("pk.attached")} /></span>}
              {p.state === "failed" && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/85 p-1 text-center">
                  <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
                  <span className="text-[10px] leading-tight">{p.error ?? t("go.q.failed")}</span>
                  {onRetry && <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => onRetry(p)}><RotateCw className="me-1 h-3 w-3" />{t("common.retry")}</Button>}
                </span>
              )}
              {(p.state === "ready" || p.state === "failed") && (
                <button type="button" aria-label={t("fd.removePhoto")} onClick={() => q.remove(p.key)} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("pk.photoRules", { n: MAX_PHOTOS })}</p>
    </div>
  );
}

/** Upload every queued photo that isn't attached yet. Returns the count that failed. */
export function useEvidenceUploader() {
  const upload = useServerFn(uploadParkingEvidence);
  return async function run(violationId: string, q: ReturnType<typeof usePhotoQueue>, only?: Pending[]) {
    let failed = 0;
    for (const p of only ?? q.items.filter((x) => x.state !== "done")) {
      q.set(p.key, { state: "uploading", error: undefined });
      try { await upload({ data: { violationId, base64: await toBase64(p.file) } }); q.set(p.key, { state: "done" }); }
      catch (e) { failed++; q.set(p.key, { state: "failed", error: evidenceError(e) }); }
    }
    return failed;
  };
}

/** Evidence history for a submitted violation (committee list). */
export function ViolationEvidence({ violationId, canAdd, canRemove }: { violationId: string; canAdd: boolean; canRemove: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listParkingEvidence);
  const queue = usePhotoQueue();
  const run = useEvidenceUploader();
  const [busy, setBusy] = useState(false);
  const key = ["parking-evidence", violationId];
  const q = useQuery({ queryKey: key, staleTime: 60_000, queryFn: () => list({ data: { violationId } }) });
  const live = (q.data ?? []).filter((e) => !e.removed_at);
  const removed = (q.data ?? []).filter((e) => e.removed_at);

  async function send(only?: Pending[]) {
    setBusy(true);
    const failed = await run(violationId, queue, only);
    setBusy(false);
    await qc.invalidateQueries({ queryKey: key });
    if (!failed) { toast.success(tu("op.photos_attached")); queue.clear(); }
  }
  async function removeOne(id: string) {
    const reason = await askText("Why remove this photo? It stays in history.");
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("parking_remove_evidence", { _id: id, _reason: reason });
    if (error) return toast.error(evidenceError(error));
    toast.success(tu("op.photo_removed_a_record_stays"));
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <section aria-label={tu("op.photo_evidence")} className="space-y-2 pt-1">
      {q.isPending ? <p className="text-xs text-muted-foreground">{tu("op.loading_photos")}</p>
        : q.isError ? <p className="text-xs text-destructive">{tu("op.couldn_t_load_photos")} <button type="button" className="underline" onClick={() => void q.refetch()}>{tu("common.retry")}</button></p>
        : live.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label={tu("op.attached_photos")}>
            {live.map((e) => (
              <li key={e.id} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
                    <img src={e.url} alt={tu("op.violation_evidence")} loading="lazy" className="h-full w-full object-cover" onError={() => void q.refetch()} />
                  </a>
                ) : <span className="flex h-full items-center justify-center p-1 text-center text-xs text-muted-foreground">{tu("op.link_expired")} <button type="button" className="underline" onClick={() => void q.refetch()}>{tu("op.reload")}</button></span>}
                {canRemove && <button type="button" aria-label={tu("fd.removePhoto")} onClick={() => void removeOne(e.id)} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow"><X className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{tu("op.no_photos")}</p>}
      {removed.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label={tu("op.removed_photos")}>
          {removed.map((e) => <li key={e.id}>{tu("op.photo_removed")} {new Date(e.removed_at!).toLocaleString()}{e.remove_reason ? ` — ${e.remove_reason}` : ""}</li>)}
        </ul>
      )}
      {canAdd && live.length < MAX_PHOTOS && (
        <div className="space-y-2">
          <PhotoPicker q={queue} disabled={busy} onRetry={(p) => void send([p])} />
          {queue.items.some((p) => p.state === "ready") && (
            <Button type="button" size="sm" className="min-h-11 rounded-xl" disabled={busy} onClick={() => void send(queue.items.filter((p) => p.state === "ready"))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("op.attach_photos")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
