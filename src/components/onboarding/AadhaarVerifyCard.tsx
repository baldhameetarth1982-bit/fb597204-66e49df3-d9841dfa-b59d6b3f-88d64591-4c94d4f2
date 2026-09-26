import { useRef, useState } from "react";
import { Camera, Loader2, CheckCircle2, AlertCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { verifyAadhaarPhoto } from "@/lib/aadhaar.functions";

type Stage = "idle" | "preview" | "uploading" | "reading" | "verified" | "failed";

export function AadhaarVerifyCard({
  userId,
  onVerified,
}: {
  userId: string;
  onVerified: (last4: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [last4, setLast4] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileBlobRef = useRef<File | null>(null);
  const verifyFn = useServerFn(verifyAadhaarPhoto);

  function pickFile() {
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      toast.error("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast.error("Photo too large. Keep under 8 MB.");
      return;
    }
    fileBlobRef.current = f;
    const url = URL.createObjectURL(f);
    setPreview(url);
    setReason(null);
    setStage("preview");
  }

  function reset() {
    fileBlobRef.current = null;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setReason(null);
    setLast4(null);
    setStage("idle");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function runVerify() {
    const f = fileBlobRef.current;
    if (!f) return;
    setStage("uploading");
    setReason(null);
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const storagePath = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("kyc-admin").upload(storagePath, f, {
      upsert: true,
      contentType: f.type,
    });
    if (upErr) {
      setStage("failed");
      setReason(upErr.message);
      return;
    }
    setStage("reading");
    try {
      const res = await verifyFn({ data: { storagePath } });
      if (res.ok) {
        setLast4(res.last4);
        setStage("verified");
        toast.success("Aadhaar verified ✓");
        onVerified(res.last4);
      } else {
        setStage("failed");
        setReason(res.reason);
      }
    } catch (e: any) {
      setStage("failed");
      setReason(e?.message ?? "Verification failed.");
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Verify your identity
        {stage === "verified" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={onFile}
        className="hidden"
      />

      {stage === "idle" && (
        <Button type="button" onClick={pickFile} className="w-full h-11 rounded-xl">
          <Camera className="h-4 w-4 mr-2" /> Take photo of Aadhaar (front)
        </Button>
      )}

      {(stage === "preview" ||
        stage === "uploading" ||
        stage === "reading" ||
        stage === "failed") &&
        preview && (
          <div className="space-y-3">
            <img
              src={preview}
              alt="Aadhaar preview"
              className="w-full max-h-48 object-contain rounded-xl border border-border bg-background"
            />
            {stage === "preview" && (
              <div className="flex gap-2">
                <Button type="button" onClick={runVerify} className="flex-1 h-11 rounded-xl">
                  Verify instantly
                </Button>
                <Button type="button" variant="outline" onClick={reset} className="h-11 rounded-xl">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            )}
            {(stage === "uploading" || stage === "reading") && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {stage === "uploading" ? "Uploading securely…" : "Reading your card with AI…"}
              </div>
            )}
            {stage === "failed" && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>{reason ?? "Verification failed."}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={reset}
                  className="w-full h-10 rounded-xl"
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Try again
                </Button>
              </div>
            )}
          </div>
        )}

      {stage === "verified" && (
        <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-3 space-y-1">
          <p className="text-sm font-medium text-green-700 dark:text-green-300">
            Verified — Aadhaar ending in •••• {last4}
          </p>
          <p className="text-xs text-muted-foreground">
            Your card photo is deleted. We only keep the last 4 digits as proof.
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        We read your Aadhaar with AI in 2–5 seconds. Your photo is stored privately and removed
        right after — only the last 4 digits are saved. We are not affiliated with UIDAI.
      </p>
    </div>
  );
}
