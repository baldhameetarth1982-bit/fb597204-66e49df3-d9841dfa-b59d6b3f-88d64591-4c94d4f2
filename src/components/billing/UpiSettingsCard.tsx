import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getSocietyUpiSettings, saveSocietyUpiSettings } from "@/lib/upi-qr-payment.functions";
import { tu } from "@/lib/i18n";

async function toBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Committee setup for the society's UPI QR. Server checks billing permission, plan and audits each change. */
export function UpiSettingsCard({ societyId }: { societyId: string }) {
  const get = useServerFn(getSocietyUpiSettings);
  const save = useServerFn(saveSocietyUpiSettings);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["upi-settings", societyId], queryFn: () => get({ data: { societyId } }), retry: false });
  const [enabled, setEnabled] = useState(false);
  const [vpa, setVpa] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) { setEnabled(q.data.enabled); setVpa(q.data.upiVpa ?? ""); setName(q.data.payeeName ?? ""); }
  }, [q.data]);

  if (q.isLoading) return <div className="h-24 rounded-2xl bg-muted animate-pulse" aria-busy="true" />;
  if (q.isError || !q.data) return null;
  if (!q.data.planEnabled) {
    return (
      <div className="rounded-2xl border border-border p-4 flex gap-3">
        <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{tu("op.upi_qr_collection_is_available")}</p>
      </div>
    );
  }

  async function onSave() {
    if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(vpa.trim())) { toast.error(tu("op.enter_a_valid_upi_id")); return; }
    if (name.trim().length < 2) { toast.error(tu("op.enter_the_account_holder_name")); return; }
    if (file && (file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type))) { toast.error(tu("op.qr_image_must_be_jpg")); return; }
    setBusy(true);
    try {
      await save({ data: { societyId, enabled, upiVpa: vpa.trim(), payeeName: name.trim(), qrBase64: file ? await toBase64(file) : null, removeQr } });
      toast.success(tu("op.upi_details_saved"));
      setFile(null); setRemoveQr(false);
      await qc.invalidateQueries({ queryKey: ["upi-settings", societyId] });
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === "rate_limited" ? "Too many changes. Try again later." : m === "invalid_file" ? "That file isn't a valid image." : "Couldn't save UPI details.");
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-4" aria-labelledby="upi-h">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="upi-h" className="font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" />{tu("op.upi_qr_payments")}</h2>
          <p className="text-sm text-muted-foreground">{tu("op.residents_scan_this_qr_then")}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={tu("op.accept_upi_qr_payments")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="upi-vpa">UPI ID</Label><Input id="upi-vpa" className="h-11" value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="society@bank" /></div>
        <div className="space-y-1"><Label htmlFor="upi-name">{tu("op.account_holder_name")}</Label><Input id="upi-name" className="h-11" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="upi-qr">{tu("op.qr_image_optional_we_can")}</Label>
        {q.data.qrUrl && !removeQr && <img src={q.data.qrUrl} alt={tu("op.current_society_upi_qr")} className="h-32 w-32 rounded-lg border border-border object-contain" />}
        <Input id="upi-qr" type="file" accept="image/png,image/jpeg,image/webp" className="h-11" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {q.data.qrUrl && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeQr} onChange={(e) => setRemoveQr(e.target.checked)} />{tu("op.remove_current_qr_image")}</label>}
      </div>
      <Button className="min-h-11 rounded-xl" onClick={() => void onSave()} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{tu("op.save_upi_details")}</Button>
    </section>
  );
}
