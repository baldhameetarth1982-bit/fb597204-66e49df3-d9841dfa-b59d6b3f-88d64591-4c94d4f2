import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
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
        const parsed = signupSchema.safeParse(form);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0].message);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: parsed.data.full_name },
          },
        });
        if (error) throw error;
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

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl text-base font-semibold"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        OTP login coming soon. For now, use email + password.
      </p>
    </AuthShell>
  );
}
