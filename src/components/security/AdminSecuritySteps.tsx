import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TwoFactorCard } from "@/components/security/TwoFactorCard";
import { userMessage } from "@/lib/user-error";
import {
  createBackupCodes, getAdminStepStatus, passkeyAuthOptions, passkeyAuthVerify,
  passkeyRegisterOptions, passkeyRegisterVerify, redeemBackupCode,
} from "@/lib/admin-step-up.functions";

/**
 * Super Admin 3-step sign-in gate: (1) email + password already done,
 * (2) fingerprint/face (passkey) or a backup code, (3) authenticator app code.
 * Required on every sign-in; the database enforces the same rule.
 */
export function AdminSecuritySteps({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getAdminStepStatus);
  const status = useQuery({ queryKey: ["admin-step-status"], queryFn: () => statusFn(), staleTime: 30_000, retry: false });
  const [totp, setTotp] = useState<{ factorId: string | null; loaded: boolean }>({ factorId: null, loaded: false });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setTotp({ factorId: data?.totp.find((f) => f.status === "verified")?.id ?? null, loaded: true });
  }
  useEffect(() => { void loadFactors(); }, []);

  const refresh = async () => {
    await supabase.auth.refreshSession();
    await loadFactors();
    await qc.invalidateQueries({ queryKey: ["admin-step-status"] });
  };

  if (status.isLoading || !totp.loaded) {
    return <div className="min-h-[60vh] grid place-items-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (status.isError || !status.data) {
    return <Shell step={2}><p className="text-sm text-destructive">Couldn't check your sign-in steps. {userMessage(status.error)}</p>
      <Button className="mt-3" onClick={() => status.refetch()}>Try again</Button></Shell>;
  }
  const s = status.data;

  if (codes && !saved) {
    return (
      <Shell step={2}>
        <p className="text-sm text-muted-foreground">Save these 10 backup codes somewhere safe, offline. Each works once, if you lose your fingerprint/face device. They won't be shown again.</p>
        <div className="grid grid-cols-2 gap-2 my-4 font-mono text-sm">{codes.map((c) => <div key={c} className="rounded-md bg-muted px-3 py-2 text-center">{c}</div>)}</div>
        <Button className="w-full" onClick={() => setSaved(true)}>I have saved them</Button>
      </Shell>
    );
  }

  if (!s.biometricDone) return <BiometricStep hasPasskey={s.passkeys > 0} onDone={refresh} />;

  const needCodes = s.backupCodesLeft === 0 && !codes;
  const codesMaker = <Shell step={2}><BackupCodesMaker onCodes={(c) => { setCodes(c); void refresh(); }} /></Shell>;

  // First-ever set is made during setup; a used-up set is replaced only after the
  // authenticator step, because the server requires a fully verified session for that.
  if (needCodes && !s.backupCodesEverMade) return codesMaker;

  if (!totp.factorId) {
    return (
      <Shell step={3}>
        <p className="text-sm text-muted-foreground mb-3">Set up an authenticator app (Google Authenticator, Microsoft Authenticator or similar). Tip: scan the same code on a second phone too, so losing one phone doesn't lock you out.</p>
        <TwoFactorCard />
        <Button variant="outline" className="w-full mt-3" onClick={refresh}>I've finished setting it up</Button>
      </Shell>
    );
  }

  if (!s.aal2) return <TotpStep factorId={totp.factorId} onDone={refresh} />;

  if (needCodes) return codesMaker;

  return <>{children}</>;
}

function Shell({ step, children }: { step: 2 | 3; children: ReactNode }) {
  return (
    <div className="min-h-[70vh] grid place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary"><ShieldCheck className="h-5 w-5" /><span className="text-sm font-medium">Super Admin sign-in · step {step} of 3</span></div>
          <CardTitle className="text-xl">{step === 2 ? "Confirm it's you" : "Authenticator code"}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function BiometricStep({ hasPasskey, onDone }: { hasPasskey: boolean; onDone: () => Promise<void> }) {
  const regOpts = useServerFn(passkeyRegisterOptions);
  const regVerify = useServerFn(passkeyRegisterVerify);
  const authOpts = useServerFn(passkeyAuthOptions);
  const authVerify = useServerFn(passkeyAuthVerify);
  const backup = useServerFn(redeemBackupCode);
  const [label, setLabel] = useState("My phone");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showBackup, setShowBackup] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); await onDone(); } catch (e) { toast.error(userMessage(e)); } finally { setBusy(false); }
  }
  const verify = async () => {
    const opts = await authOpts();
    const response = await startAuthentication({ optionsJSON: opts as any });
    await authVerify({ data: { response } });
  };
  const register = () => run(async () => {
    const opts = await regOpts({ data: { label } });
    const response = await startRegistration({ optionsJSON: opts as any });
    await regVerify({ data: { label, response } });
    toast.success("Device added. Now confirm with it once.");
    await verify();
  });

  return (
    <Shell step={2}>
      {hasPasskey ? (
        <>
          <p className="text-sm text-muted-foreground mb-4">Use your fingerprint, face or device screen lock.</p>
          <Button className="w-full min-h-11" disabled={busy} onClick={() => run(verify)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Verify with fingerprint / face
          </Button>
          {!showBackup ? (
            <Button variant="link" className="w-full mt-2" onClick={() => setShowBackup(true)}>Lost your device? Use a backup code</Button>
          ) : (
            <div className="mt-4 space-y-2">
              <Label htmlFor="bc">Backup code</Label>
              <Input id="bc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoComplete="one-time-code" maxLength={9} />
              <Button variant="outline" className="w-full min-h-11" disabled={busy || code.trim().length < 8}
                onClick={() => run(async () => { await backup({ data: { code } }); })}>
                <KeyRound className="h-4 w-4" /> Use backup code
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">Set up fingerprint or face login on this device. You'll need it every time you sign in as Super Admin. You can add a second device later.</p>
          <Label htmlFor="dl">Device name</Label>
          <Input id="dl" className="mb-3" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          <Button className="w-full min-h-11" disabled={busy || !label.trim()} onClick={register}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Set up fingerprint / face
          </Button>
        </>
      )}
    </Shell>
  );
}

function BackupCodesMaker({ onCodes }: { onCodes: (c: string[]) => void }) {
  const make = useServerFn(createBackupCodes);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground mb-4">Create backup codes in case you lose your fingerprint/face device.</p>
      <Button className="w-full min-h-11" disabled={busy} onClick={async () => {
        setBusy(true);
        try { onCodes((await make()).codes); } catch (e) { toast.error(userMessage(e)); } finally { setBusy(false); }
      }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Create backup codes</Button>
    </>
  );
}

function TotpStep({ factorId, onDone }: { factorId: string; onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) { setBusy(false); setCode(""); return toast.error("That code didn't work. Check the time on your phone and try again."); }
    await onDone();
    setBusy(false);
  }
  return (
    <Shell step={3}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">Open your authenticator app and enter the 6-digit SociyoHub code.</p>
        <Label htmlFor="totp">Code</Label>
        <Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
        <Button type="submit" className="w-full min-h-11" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} Verify
        </Button>
      </form>
    </Shell>
  );
}
