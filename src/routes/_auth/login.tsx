import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Loader2, ShieldCheck, Lock, FileCheck2 } from "lucide-react";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/login")({
  head: () => ({
    meta: [
      { title: "Sign in — SocioHub" },
      { name: "description", content: "Sign in to your SocioHub account." },
    ],
  }),
  component: LoginPage,
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "At least 6 characters").max(128),
});

const signupSchema = loginSchema.extend({
  full_name: z.string().trim().min(1, "Required").max(100),
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });
  const [agreed, setAgreed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const parsed = loginSchema.safeParse(form);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0].message);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        toast.success("Welcome back");
        navigate({ to: "/" });
      } else {
        if (!agreed) {
          toast.error("Please accept the Terms of Service and Privacy Policy");
          return;
        }
        const parsed = signupSchema.safeParse(form);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0].message);
          return;
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              full_name: parsed.data.full_name,
              accepted_terms_at: new Date().toISOString(),
              referral_code: localStorage.getItem("sociohub:ref") || undefined,
            },
          },
        });
        if (error) throw error;
        if (signUpData.user) {
          await supabase.from("profiles").update({ accepted_terms_at: new Date().toISOString() }).eq("id", signUpData.user.id);
          localStorage.removeItem("sociohub:ref");
        }
        toast.success("Account created — check your inbox to verify.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold tracking-tight text-center">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        {mode === "signin"
          ? "Sign in to manage your society."
          : "Get started in under a minute."}
      </p>

      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as "signin" | "signup")}
        className="mt-6"
      >
        <TabsList className="grid w-full grid-cols-2 rounded-xl">
          <TabsTrigger value="signin" className="rounded-lg">
            Sign in
          </TabsTrigger>
          <TabsTrigger value="signup" className="rounded-lg">
            Sign up
          </TabsTrigger>
        </TabsList>

        <TabsContent value={mode} className="mt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  value={form.full_name}
                  onChange={(e) =>
                    setForm({ ...form, full_name: e.target.value })
                  }
                  placeholder="Priya Sharma"
                  className="rounded-xl h-11"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                className="rounded-xl h-11"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <Link
                    to="/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot?
                  </Link>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
                placeholder="••••••••"
                className="rounded-xl h-11"
                required
              />
            </div>

            {mode === "signup" && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span>
                  I agree to the{" "}
                  <Link to="/terms" target="_blank" className="text-primary underline">
                    Terms of Service &amp; Privacy Policy
                  </Link>
                  .
                </span>
              </label>
            )}

            <Button
              type="submit"
              disabled={loading || (mode === "signup" && !agreed)}
              className="w-full h-11 rounded-xl text-base font-semibold"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <div className="mt-5 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>or continue with</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
            if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Google sign-in failed");
          } finally {
            setLoading(false);
          }
        }}
        className="mt-3 w-full h-11 rounded-xl font-semibold gap-2"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5"><path fill="#EA4335" d="M12 11v3.2h4.5c-.2 1.2-1.6 3.5-4.5 3.5-2.7 0-4.9-2.2-4.9-5s2.2-5 4.9-5c1.5 0 2.6.6 3.2 1.2l2.2-2.1C15.9 5.5 14.1 4.7 12 4.7 7.9 4.7 4.6 8 4.6 12s3.3 7.3 7.4 7.3c4.3 0 7.1-3 7.1-7.2 0-.5 0-.9-.1-1.3H12z"/></svg>
        Continue with Google
      </Button>

      <div className="mt-6 rounded-2xl bg-secondary/60 p-4 space-y-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Your data is safe with SocioHub
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-1.5">
          <li className="flex gap-1.5"><Lock className="h-3 w-3 mt-0.5 text-primary" /> Encrypted end-to-end, never sold or shared</li>
          <li className="flex gap-1.5"><FileCheck2 className="h-3 w-3 mt-0.5 text-primary" /> GDPR-aligned, ISO-grade infrastructure</li>
          <li className="flex gap-1.5"><ShieldCheck className="h-3 w-3 mt-0.5 text-primary" /> Aadhaar verified residents only</li>
        </ul>
        <p className="text-[10px] text-muted-foreground pt-1">
          <Link to="/terms" className="underline">Terms</Link> · <Link to="/terms" className="underline">Privacy</Link>
        </p>
      </div>
    </AuthShell>
  );
}
