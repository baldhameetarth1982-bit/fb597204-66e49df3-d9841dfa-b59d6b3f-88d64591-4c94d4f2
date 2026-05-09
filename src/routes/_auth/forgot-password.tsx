import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — SocioHub" },
      { name: "description", content: "Reset your SocioHub password." },
    ],
  }),
  component: ForgotPasswordPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo: `${window.location.origin}/reset-password` },
      );
      if (error) throw error;
      setSent(true);
      toast.success("Check your email for a reset link.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold tracking-tight text-center">
        Forgot your password?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        We'll email you a secure link to reset it.
      </p>

      {sent ? (
        <div className="mt-6 rounded-xl bg-secondary p-4 text-center text-sm">
          A reset link has been sent to <strong>{email}</strong>. Check your
          inbox.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
            Send reset link
          </Button>
        </form>
      )}

      <Link
        to="/login"
        className="mt-6 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
    </AuthShell>
  );
}
