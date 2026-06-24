import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, KeyRound, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * TOTP 2FA enrollment + management.
 *
 * Uses Supabase's native MFA API (no extra deps, no custom table):
 *   - mfa.enroll() → returns factor_id + TOTP secret + QR (data URI).
 *   - mfa.challenge() + mfa.verify(code) → confirms enrollment.
 *   - mfa.listFactors() → shows current verified factors.
 *   - mfa.unenroll(factorId) → removes a factor.
 *
 * AAL2 enforcement at login lives in src/routes/_auth/login.tsx.
 */
export function TwoFactorCard() {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setLoading(false);
      return;
    }
    const verified = data.totp.find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    // Clean up any stale unverified factors so re-enrollment starts fresh.
    for (const f of data.totp) {
      if (f.status !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function startEnroll() {
    setWorking(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `SocioHub-${Date.now()}`,
    });
    setWorking(false);
    if (error) return toast.error(error.message);
    setEnroll({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function confirmEnroll() {
    if (!enroll) return;
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit code");
    setWorking(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: enroll.factorId,
    });
    if (chErr) {
      setWorking(false);
      return toast.error(chErr.message);
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: ch.id,
      code,
    });
    setWorking(false);
    if (vErr) return toast.error(vErr.message);
    toast.success("Two-factor authentication enabled");
    setEnroll(null);
    setCode("");
    void refresh();
  }

  async function disable() {
    if (!verifiedFactorId) return;
    if (!confirm("Disable two-factor authentication?")) return;
    setWorking(true);
    const { error } = await supabase.auth.mfa.unenroll({
      factorId: verifiedFactorId,
    });
    setWorking(false);
    if (error) return toast.error(error.message);
    toast.success("Two-factor authentication disabled");
    void refresh();
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : verifiedFactorId ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="font-medium">2FA is on</p>
                <p className="text-sm text-muted-foreground">
                  You'll be asked for a code from your authenticator app at sign-in.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={working}
              onClick={disable}
            >
              {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disable 2FA
            </Button>
          </div>
        ) : enroll ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <p className="text-sm">
                Scan this QR with Google Authenticator, 1Password, Authy, or any TOTP app.
              </p>
              <div className="flex items-center gap-4">
                <img
                  src={enroll.qr}
                  alt="2FA QR code"
                  className="h-40 w-40 rounded-lg bg-white p-2"
                />
                <div className="text-xs font-mono break-all text-muted-foreground">
                  Or enter manually:
                  <br />
                  <span className="text-foreground">{enroll.secret}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-2 max-w-xs">
              <Label>6-digit code</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="rounded-xl tracking-widest text-center"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={confirmEnroll} disabled={working} className="rounded-xl">
                {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify & enable
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEnroll(null);
                  setCode("");
                  void refresh();
                }}
                className="rounded-xl"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add a second sign-in step using an authenticator app. Recommended for society admins.
            </p>
            <Button onClick={startEnroll} disabled={working} className="rounded-xl">
              {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <KeyRound className="h-4 w-4 mr-2" />
              Set up 2FA
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
