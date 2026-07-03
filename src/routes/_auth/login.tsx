import { useMemo, useState } from "react";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Loader2, Mail, Lock, ShieldCheck, FileCheck2, Phone, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLE_HOME, ROLES } from "@/config/roles";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { PhoneOtpForm } from "@/components/auth/PhoneOtpForm";
import { TruecallerButton } from "@/components/auth/TruecallerButton";
import { getCapabilities, startTruecallerAuth } from "@/lib/auth-service";

export const Route = createFileRoute("/_auth/login")({
  head: () => ({
    meta: [
      { title: "Sign in — SocioHub" },
      { name: "description", content: "Sign in to SocioHub — Google, Phone, Truecaller or email." },
    ],
  }),
  component: LoginPage,
});

type Step = "choose" | "phone" | "email";

function LoginPage() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, primaryRole, profile } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState<null | "email" | "google" | "truecaller">(null);
  const caps = useMemo(() => getCapabilities(), []);

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
    if (primaryRole === ROLES.SUPER_ADMIN) return <Navigate to={ROLE_HOME[ROLES.SUPER_ADMIN]} replace />;
    if (primaryRole && profile?.society_id) return <Navigate to={ROLE_HOME[primaryRole]} replace />;
    return <Navigate to="/onboarding" replace />;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName.trim() || null },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(null);
    }
  }

  async function withGoogle() {
    setBusy("google");
    try {
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (res.error) throw res.error;
      if (res.redirected) return;
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function withTruecaller() {
    setBusy("truecaller");
    try {
      const r = await startTruecallerAuth();
      if (!r.ok) toast.error(r.error ?? "Truecaller sign-in unavailable");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell>
      {step !== "choose" && (
        <button
          type="button"
          onClick={() => setStep("choose")}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}

      <h1 className="text-2xl font-semibold tracking-tight text-center">
        {step === "email"
          ? mode === "signin" ? "Sign in with email" : "Create your account"
          : step === "phone"
            ? "Continue with phone"
            : "Welcome to SocioHub"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        Society management, simplified.
      </p>

      {step === "choose" && (
        <div className="mt-6 space-y-3">
          <GoogleButton onClick={withGoogle} loading={busy === "google"} />
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep("phone")}
            className="w-full h-12 rounded-2xl font-semibold gap-2"
          >
            <Phone className="h-4 w-4" /> Continue with Phone
          </Button>
          {caps.truecaller && (
            <TruecallerButton onClick={withTruecaller} loading={busy === "truecaller"} />
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep("email")}
            className="w-full h-12 rounded-2xl font-semibold gap-2"
          >
            <Mail className="h-4 w-4" /> Continue with Email
          </Button>
        </div>
      )}

      {step === "phone" && (
        <div className="mt-6">
          <PhoneOtpForm
            submitLabel="Verify & continue"
            onVerified={({ phone, firebaseUid }) => {
              try {
                sessionStorage.setItem(
                  "sociohub:pending_phone",
                  JSON.stringify({ phone, firebaseUid }),
                );
              } catch {}
              toast.success("Phone verified. Complete sign in below.");
              setStep("choose");
            }}
          />
          <p className="mt-4 text-[11px] text-muted-foreground text-center">
            After verifying, complete sign-in with Google or Email — your phone will link automatically.
          </p>
        </div>
      )}

      {step === "email" && (
        <>
          <form onSubmit={submitEmail} className="mt-6 space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Full name</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="h-12 rounded-2xl"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <Mail className="h-4 w-4 text-primary" /> Email
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-2xl"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm">
                <Lock className="h-4 w-4 text-primary" /> Password
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-2xl"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={busy === "email"}
              className="w-full h-12 rounded-2xl text-base font-semibold"
            >
              {busy === "email" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </>
      )}

      <div className="mt-6 rounded-2xl bg-secondary/60 p-4 space-y-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Your data is safe with SocioHub
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-1.5">
          <li className="flex gap-1.5">
            <Lock className="h-3 w-3 mt-0.5 text-primary" /> Encrypted end-to-end, never sold or shared
          </li>
          <li className="flex gap-1.5">
            <FileCheck2 className="h-3 w-3 mt-0.5 text-primary" /> GDPR-aligned, ISO-grade infrastructure
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground pt-1">
          <Link to="/terms" className="underline">Terms</Link> ·{" "}
          <Link to="/privacy" className="underline">Privacy</Link>
        </p>
      </div>
    </AuthShell>
  );
}
