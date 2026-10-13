import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MessageCircle, MessageSquare, Phone, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Channel = { type: "sms" | "whatsapp"; number: string; code: string; intent: string };

async function post(body: unknown, link = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (link) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch("/api/public/auth/reverse-otp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { ok: res.ok, data };
}

/**
 * Phone sign-in where the person sends a code FROM their phone (Reverse OTP).
 * With `linkToCurrentUser`, a signed-in person proves their number instead of signing in.
 */
export function ReverseOtpSignIn({ onSignedIn, linkToCurrentUser = false }: { onSignedIn: () => void; linkToCurrentUser?: boolean }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("+91");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ token: string; channels: Channel[] } | null>(null);
  const timer = useRef<number | null>(null);
  const normalized = phone.replace(/[\s-]/g, "");

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function start() {
    setError(null);
    if (!/^\+91[6-9]\d{9}$/.test(normalized)) {
      setError(t("reverseOtp.invalid", "Enter a valid Indian mobile number, e.g. +919876543210"));
      return;
    }
    setBusy(true);
    try {
      const r = await post({ action: "start", phone: normalized });
      if (!r.ok || !r.data.attemptToken) { setError(r.data.error ?? t("reverseOtp.failed", "Could not start phone sign-in.")); return; }
      setAttempt({ token: r.data.attemptToken, channels: r.data.channels });
      poll(r.data.attemptToken, Date.now());
    } catch {
      setError(t("auth.toast.unreachable", "Can't reach the server. Check your connection."));
    } finally {
      setBusy(false);
    }
  }

  function poll(token: string, startedAt: number) {
    timer.current = window.setTimeout(async () => {
      if (Date.now() - startedAt > 15 * 60_000) { reset(t("reverseOtp.expired", "This attempt expired. Please start again.")); return; }
      const r = await post({ action: "check", attemptToken: token }, linkToCurrentUser).catch(() => null);
      const s = r?.data?.status;
      if (linkToCurrentUser && s === "linked") { onSignedIn(); return; }
      if (s === "verified" && r?.data.token_hash) {
        const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: r.data.token_hash });
        if (vErr) { reset(t("auth.toast.couldNotSignIn", "Could not sign in.")); return; }
        toast.success(t("auth.toast.signedIn", "Signed in"));
        onSignedIn();
        return;
      }
      if (s === "expired" || (r && !r.ok)) { reset(r?.data?.error ?? t("reverseOtp.expired", "This attempt expired. Please start again.")); return; }
      poll(token, startedAt);
    }, 3000);
  }

  function reset(msg?: string) {
    if (timer.current) window.clearTimeout(timer.current);
    setAttempt(null);
    if (msg) setError(msg);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <Clock className="h-5 w-5 shrink-0 text-warning" aria-hidden />
          <p className="text-foreground">{error}</p>
        </div>
      )}
      {!attempt ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="ro-phone" className="flex items-center gap-1.5 text-sm">
              <Phone className="h-4 w-4 text-primary" /> {t("otp.mobile", "Mobile number")}
            </Label>
            <Input id="ro-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210" className="text-base" autoFocus />
            <p className="text-[11px] text-muted-foreground">
              {t("reverseOtp.hint", "You'll send a short code from this phone by SMS or WhatsApp. Normal message charges may apply.")}
            </p>
          </div>
          <Button onClick={start} disabled={busy} className="w-full min-h-11">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("reverseOtp.continue", "Continue")}
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {t("reverseOtp.instructions", "Send this code from {{phone}} using one option below. Don't edit the message.", { phone: normalized })}
          </p>
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("reverseOtp.yourCode", "Your code")}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-widest text-foreground break-all">{attempt.channels[0]?.code}</p>
          </div>
          {attempt.channels.map((c) => {
            // WhatsApp refuses to open inside an embedded frame ("api.whatsapp.com is blocked").
            // Always open it as a real top-level page/app instead.
            const waUrl = `https://wa.me/${c.number}?text=${encodeURIComponent(c.code)}`;
            const href = c.type === "whatsapp" ? waUrl : c.intent;
            const openWhatsApp = (e: React.MouseEvent) => {
              if (c.type !== "whatsapp") return;
              e.preventDefault();
              const w = window.open(waUrl, "_blank", "noopener,noreferrer");
              if (!w) {
                try { (window.top ?? window).location.href = waUrl; } catch { window.location.href = waUrl; }
              }
            };
            return (
              <div key={c.type} className="space-y-1">
                <Button asChild variant={c.type === "sms" ? "default" : "outline"} className="w-full min-h-11">
                  <a href={href} onClick={openWhatsApp} target={c.type === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer">
                    {c.type === "sms" ? <MessageSquare className="h-4 w-4 mr-2" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                    {c.type === "sms" ? t("reverseOtp.sendSms", "Send by SMS") : t("reverseOtp.sendWhatsapp", "Send on WhatsApp")}
                  </a>
                </Button>
                {c.type === "whatsapp" && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {t("reverseOtp.waManual", "If WhatsApp doesn't open, send {{code}} to +{{number}} on WhatsApp.", { code: c.code, number: c.number })}
                  </p>
                )}
              </div>
            );
          })}
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("reverseOtp.waiting", "Waiting for your message…")}
          </p>
          <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => reset()}>
            {t("otp.change", "Change number")}
          </Button>
        </div>
      )}
    </div>
  );
}
