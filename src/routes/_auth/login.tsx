import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Loader2, Mail, Lock, ShieldCheck, FileCheck2, Phone, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLE_HOME, ROLES } from "@/config/roles";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { PhoneOtpForm } from "@/components/auth/PhoneOtpForm";
import { TruecallerButton } from "@/components/auth/TruecallerButton";
import {
  getCapabilities,
  signInWithGoogleFirebase,
  signInWithVerifiedPhone,
  startTruecallerAuth,
} from "@/lib/auth-service";
import { sanitizeNextPath } from "@/lib/safe-next";
import { useServerFn } from "@tanstack/react-start";
import { assertLoginAllowed } from "@/lib/login-guard.functions";
import { emailSignIn, emailSignUp } from "@/lib/email-auth.functions";
import { Clock } from "lucide-react";
import { LanguageSelector } from "@/components/shared/LanguageSelector";

export const Route = createFileRoute("/_auth/login")({
  head: () => ({
    meta: [
      { title: "Sign in — SociyoHub" },
      { name: "description", content: "Sign in to SociyoHub — Google, Phone, Truecaller or email." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    // Only accept same-origin relative paths as post-login return targets.
    const safe = sanitizeNextPath(s.next);
    return safe ? { next: safe } : {};
  },
  component: LoginPage,
});

function goNext(next: string | undefined, fallback: () => void) {
  if (next) {
    window.location.href = next;
    return;
  }
  fallback();
}

type Step = "choose" | "phone" | "email";

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { isLoading, isAuthenticated, primaryRole, profile } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState<null | "email" | "google" | "truecaller">(null);
  const [limited, setLimited] = useState<string | null>(null);
  const caps = useMemo(() => getCapabilities(), []);
  const assertAllowed = useServerFn(assertLoginAllowed);
  const signInFn = useServerFn(emailSignIn);
  const signUpFn = useServerFn(emailSignUp);
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <AuthShell>
        <div className="min-h-[200px] grid place-items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AuthShell>
    );
  }

  if (isAuthenticated) {
    if (next) {
      window.location.href = next;
      return (
        <AuthShell>
          <div className="min-h-[200px] grid place-items-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </AuthShell>
      );
    }
    if (primaryRole === ROLES.SUPER_ADMIN) return <Navigate to={ROLE_HOME[ROLES.SUPER_ADMIN]} replace />;
    if (primaryRole && profile?.society_id) return <Navigate to={ROLE_HOME[primaryRole]} replace />;
    return <Navigate to="/onboarding" search={{ ref: undefined }} replace />;
  }

  const emailRedirect = `${window.location.origin}${next ?? "/"}`;


  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setLimited(null);
    const addr = email.trim();
    try {
      if (mode === "signup") {
        const r = await signUpFn({ data: { email: addr, password, fullName: fullName.trim() || undefined, next } });
        if (!r.ok) { if (r.reason === "limited") setLimited(r.message); else toast.error(r.message); return; }
        toast.success(t("auth.toast.created"));
      } else {
        const r = await signInFn({ data: { email: addr, password } });
        if (!r.ok) { if (r.reason === "limited") setLimited(r.message); else toast.error(r.message); return; }
        const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
        if (error) throw error;
      }
    } catch {
      toast.error(mode === "signup" ? t("auth.toast.createFailed") : t("auth.toast.signInFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function sendReset() {
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      toast.error(t("auth.toast.enterEmailFirst"));
      return;
    }
    setBusy("email");
    try {
      await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Same message either way so account existence isn't revealed.
      toast.success(t("auth.toast.resetSent"));
    } catch {
      toast.error(t("auth.toast.resetFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function withGoogle() {
    setBusy("google");
    setLimited(null);
    try {
      const gate = await assertAllowed({ data: {} }).catch(() => null);
      if (!gate) { toast.error(t("auth.toast.unreachable")); return; }
      if (!gate.ok) { setLimited(gate.message); return; }
      const r = await signInWithGoogleFirebase();
      if (!r.ok) {
        if (/temporarily limited|too many/i.test(r.error ?? "")) setLimited(r.error!);
        else toast.error(r.error ?? t("auth.toast.googleFailed"));
        return;
      }
      goNext(next, () => navigate({ to: "/" }));
    } catch {
      toast.error(t("auth.toast.googleFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function withTruecaller() {
    setBusy("truecaller");
    try {
      const r = await startTruecallerAuth();
      if (!r.ok) toast.error(r.error ?? t("auth.toast.truecallerUnavailable"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell>
      {step !== "choose" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStep("choose")}
          className="mb-3 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" /> {t("auth.back")}
        </Button>
      )}

      <h1 className="type-headline text-center">
        {step === "email"
          ? mode === "signin" ? t("auth.title.emailSignIn") : t("auth.title.createAccount")
          : step === "phone"
            ? t("auth.title.phone")
            : t("auth.title.welcome")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        {t("auth.tagline")}
      </p>
      <div className="mt-3 flex justify-center">
        <LanguageSelector compact />
      </div>

      {limited && (
        <div role="alert" className="mt-5 flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <Clock className="h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-foreground">{t("auth.limited.title")}</p>
            <p className="mt-0.5 text-muted-foreground">{limited} {t("auth.limited.temporary")}</p>
          </div>
        </div>
      )}

      {step === "choose" && (
        <div className="mt-6 space-y-3">
          <GoogleButton onClick={withGoogle} loading={busy === "google"} />
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep("phone")}
            className="w-full"
          >
            <Phone className="h-4 w-4" /> {t("auth.continuePhone")}
          </Button>
          {caps.truecaller && (
            <TruecallerButton onClick={withTruecaller} loading={busy === "truecaller"} />
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep("email")}
            className="w-full"
          >
            <Mail className="h-4 w-4" /> {t("auth.continueEmail")}
          </Button>
        </div>
      )}

      {step === "phone" && (
        <div className="mt-6">
          <PhoneOtpForm
            submitLabel={t("auth.verifySignIn")}
            onVerified={async ({ phone, firebaseIdToken }) => {
              const r = await signInWithVerifiedPhone({ phone, firebaseIdToken });
              if (!r.ok) {
                toast.error(r.error ?? t("auth.toast.couldNotSignIn"));
                return;
              }
              toast.success(t("auth.toast.signedIn"));
              goNext(next, () => navigate({ to: "/" }));
            }}
          />
          <p className="mt-4 text-[11px] text-muted-foreground text-center">
            {t("auth.autoCreate")}
          </p>
        </div>
      )}

      {step === "email" && (
        <>
          <form onSubmit={submitEmail} className="mt-6 space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-name" className="text-sm">{t("auth.fullName")}</Label>
                <Input
                  id="auth-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("auth.yourName")}
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="flex items-center gap-1.5 text-sm">
                <Mail className="h-4 w-4 text-primary" /> {t("auth.email")}
              </Label>
              <Input
                type="email"
                id="auth-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password" className="flex items-center gap-1.5 text-sm">
                <Lock className="h-4 w-4 text-primary" /> {t("auth.password")}
              </Label>
              <PasswordInput
                
                id="auth-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={busy === "email"}
              className="w-full"
            >
              {busy === "email" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? t("auth.signIn") : t("auth.createAccount")}
            </Button>
          </form>
          {mode === "signin" && (
            <Button
              type="button"
              variant="link"
              disabled={busy === "email"}
              onClick={sendReset}
              className="mt-2 w-full min-h-11 text-primary"
            >
              {t("auth.forgot")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-muted-foreground"
          >
            {mode === "signin" ? t("auth.toSignUp") : t("auth.toSignIn")}
          </Button>
        </>
      )}

      <div className="mt-6 rounded-lg border border-border bg-secondary/60 p-4 space-y-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {t("auth.safe.title")}
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-1.5">
          <li className="flex gap-1.5">
            <Lock className="h-3 w-3 mt-0.5 text-primary" /> {t("auth.safe.checked")}
          </li>
          <li className="flex gap-1.5">
            <FileCheck2 className="h-3 w-3 mt-0.5 text-primary" /> {t("auth.safe.role")}
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground pt-1">
          <Link to="/terms" className="underline">{t("auth.terms")}</Link> ·{" "}
          <Link to="/privacy" className="underline">{t("auth.privacy")}</Link>
        </p>
      </div>
    </AuthShell>
  );
}
