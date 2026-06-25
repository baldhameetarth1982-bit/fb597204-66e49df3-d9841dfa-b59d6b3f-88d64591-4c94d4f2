import { createFileRoute, Navigate, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Building2, ArrowLeft, Copy, CheckCircle2, ShieldCheck, Phone } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getFirebaseAuth } from "@/lib/firebase";
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";

export const Route = createFileRoute("/onboarding/create")({
  head: () => ({ meta: [{ title: "Create society — SocioHub" }] }),
  component: CreateSociety,
});

function CreateSociety() {
  const { isLoading, isAuthenticated, user, refresh } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "" });

  // Simple human-check (math captcha)
  const captcha = useMemo(() => {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    return { a, b, answer: a + b };
  }, []);
  const [captchaInput, setCaptchaInput] = useState("");
  const [agreed, setAgreed] = useState(false);

  // Phone verification (required to create a society)
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [otpStage, setOtpStage] = useState<"idle" | "sent" | "verified">("idle");
  const [otpBusy, setOtpBusy] = useState(false);
  const confirmRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  useEffect(() => () => { try { recaptchaRef.current?.clear(); } catch {} }, []);

  const [created, setCreated] = useState<{ id: string; code: string; name: string } | null>(null);

  useEffect(() => {
    async function check() {
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("society_id")
        .eq("user_id", user.id)
        .eq("role", "society_admin")
        .not("society_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (data?.society_id) navigate({ to: "/onboarding/plan" });
    }
    void check();
  }, [user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;

  async function sendOtp() {
    if (!/^\+\d{8,15}$/.test(phone)) {
      toast.error("Enter phone in international format, e.g. +919876543210");
      return;
    }
    setOtpBusy(true);
    try {
      const auth = getFirebaseAuth();
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      }
      confirmRef.current = await signInWithPhoneNumber(auth, phone, recaptchaRef.current);
      setOtpStage("sent");
      toast.success("OTP sent");
    } catch (e: any) {
      toast.error(e.message ?? "Could not send OTP");
    }
    setOtpBusy(false);
  }

  async function verifyOtp() {
    if (!confirmRef.current || !user) return;
    setOtpBusy(true);
    try {
      const res = await confirmRef.current.confirm(otp.trim());
      const fbUid = res.user.uid;
      const { error } = await (supabase as any)
        .from("phone_verifications")
        .upsert({ user_id: user.id, phone, firebase_uid: fbUid }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      setOtpStage("verified");
      toast.success("Phone verified ✓");
    } catch (e: any) {
      toast.error(e.message ?? "Wrong code");
    }
    setOtpBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (otpStage !== "verified") {
      toast.error("Please verify your phone number first");
      return;
    }
    if (Number(captchaInput) !== captcha.answer) {
      toast.error("Verification failed", { description: "Please solve the math check." });
      return;
    }
    if (!agreed) {
      toast.error("Please accept the Terms of Service and Privacy Policy");
      return;
    }
    setSaving(true);
    const ref = typeof window !== "undefined" ? localStorage.getItem("sociohub:ref") : null;
    const { data: soc, error: socErr } = await supabase
      .rpc("create_society_for_current_user", {
        _name: form.name.trim(),
        _city: form.city.trim() || undefined,
        _state: form.state.trim() || undefined,
        _referral_code: ref || undefined,
      })
      .single();
    if (socErr || !soc) {
      setSaving(false);
      console.error("[create-society] create_society_for_current_user failed", socErr);
      toast.error(`Society: ${socErr?.message ?? "Could not create society"}`);
      return;
    }
    if (ref) {
      localStorage.removeItem("sociohub:ref");
    }
    await refresh();
    setSaving(false);
    setCreated({ id: soc.id, code: soc.invite_code as string, name: soc.name });
  }

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function copyCode() {
    if (!created) return;
    navigator.clipboard.writeText(created.code);
    toast.success("Code copied");
  }

  if (created) {
    return (
      <div className="px-5 py-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Society created</h1>
          <p className="text-sm text-muted-foreground">
            Share this code with residents so they can join <strong>{created.name}</strong>.
          </p>
        </div>

        <Card className="rounded-3xl border-0 bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-xs uppercase tracking-wider opacity-80">Society invite code</p>
            <p className="text-4xl font-bold tracking-[0.4em] font-mono">{created.code}</p>
            <Button
              onClick={copyCode}
              variant="secondary"
              className="rounded-xl h-10 mt-2"
            >
              <Copy className="h-4 w-4 mr-2" /> Copy code
            </Button>
          </CardContent>
        </Card>

        <Button
          onClick={() => navigate({ to: "/onboarding/plan" })}
          className="w-full h-12 rounded-xl"
        >
          Continue — choose your plan
        </Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 space-y-6">
      <Link
        to="/onboarding"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Link>

      <header className="space-y-2">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your society</h1>
        <p className="text-sm text-muted-foreground">
          You'll become the Chairman with full admin rights. A unique 6-digit code will be generated automatically.
        </p>
      </header>

      <Card className="rounded-3xl">
        <CardContent className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Society name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                maxLength={120}
                placeholder="e.g. Sunrise Heights"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  maxLength={60}
                  placeholder="Mumbai"
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  maxLength={60}
                  placeholder="Maharashtra"
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Phone className="h-4 w-4 text-primary" />
                Verify your phone {otpStage === "verified" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              </div>
              {otpStage !== "verified" && (
                <>
                  <div className="flex gap-2">
                    <Input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+919876543210"
                      disabled={otpStage === "sent" || otpBusy}
                      className="h-10 rounded-xl flex-1"
                    />
                    {otpStage === "idle" && (
                      <Button type="button" onClick={sendOtp} disabled={otpBusy} className="h-10 rounded-xl">
                        {otpBusy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Send OTP
                      </Button>
                    )}
                  </div>
                  {otpStage === "sent" && (
                    <div className="flex gap-2">
                      <Input
                        inputMode="numeric"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="6-digit OTP"
                        className="h-10 rounded-xl flex-1 tracking-[0.3em] text-center"
                      />
                      <Button type="button" onClick={verifyOtp} disabled={otpBusy || otp.length !== 6} className="h-10 rounded-xl">
                        {otpBusy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Verify
                      </Button>
                    </div>
                  )}
                </>
              )}
              {otpStage === "verified" && (
                <p className="text-xs text-muted-foreground">{phone} verified</p>
              )}
              <div id="recaptcha-container" />
            </div>

            <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Quick verification
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  What is {captcha.a} + {captcha.b}?
                </span>
                <Input
                  inputMode="numeric"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  className="h-9 w-20 rounded-lg text-center"
                  required
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary" />
              <span>
                I agree to the{" "}
                <Link to="/terms" target="_blank" className="text-primary underline">
                  Terms of Service &amp; Privacy Policy
                </Link>.
              </span>
            </label>

            <Button type="submit" disabled={saving || !agreed || otpStage !== "verified"} className="w-full h-12 rounded-xl">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create society
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
