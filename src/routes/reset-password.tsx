import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/shared/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — SociyoHub" },
      { name: "description", content: "Choose a new password for your SociyoHub account." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Use at least 6 characters.");
    if (password !== confirm) return toast.error("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error("Couldn't update the password. Open the link from your email again.");
    toast.success("Password updated.");
    navigate({ to: "/login" });
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {!ready ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Open this page from the reset link in your email. Checking your link…
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-pw" className="flex items-center gap-1.5 text-sm">
              <Lock className="h-4 w-4 text-primary" /> New password
            </Label>
            <Input id="new-pw" type="password" minLength={6} required autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw" className="text-sm">Confirm password</Label>
            <Input id="confirm-pw" type="password" minLength={6} required autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="w-full min-h-11">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
