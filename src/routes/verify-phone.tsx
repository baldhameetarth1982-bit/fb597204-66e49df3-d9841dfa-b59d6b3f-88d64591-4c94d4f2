import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/shared/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { PhoneOtpForm } from "@/components/auth/PhoneOtpForm";
import { toast } from "sonner";

export const Route = createFileRoute("/verify-phone")({
  head: () => ({ meta: [{ title: "Verify phone — SociyoHub" }] }),
  component: VerifyPhonePage,
});

function VerifyPhonePage() {
  const { isLoading, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [alreadyVerified, setAlreadyVerified] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("phone_verifications")
        .select("phone")
        .eq("user_id", user.id)
        .maybeSingle();
      setAlreadyVerified(Boolean(data?.phone));
      setChecking(false);
    })();
  }, [user]);

  // Auto-link any phone that was verified during the phone-first flow before
  // the Google session existed.
  useEffect(() => {
    if (!user) return;
    try {
      const pending = sessionStorage.getItem("sociohub:pending_phone");
      if (!pending) return;
      const { phone, firebaseUid } = JSON.parse(pending) as { phone: string; firebaseUid: string };
      (async () => {
        const { error } = await (supabase as any)
          .from("phone_verifications")
          .upsert({ user_id: user.id, phone, firebase_uid: firebaseUid }, { onConflict: "user_id" });
        if (!error) {
          sessionStorage.removeItem("sociohub:pending_phone");
          setAlreadyVerified(true);
          toast.success("Phone linked");
        }
      })();
    } catch {
      /* ignore */
    }
  }, [user]);

  if (isLoading) {
    return (
      <AuthShell>
        <div className="min-h-[200px] grid place-items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AuthShell>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!checking && alreadyVerified) return <Navigate to="/" replace />;

  return (
    <AuthShell>
      <div className="text-center space-y-2">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify your phone</h1>
        <p className="text-sm text-muted-foreground">
          Every SociyoHub account is linked to a verified mobile number.
        </p>
      </div>

      <div className="mt-6">
        <PhoneOtpForm
          linkToCurrentUser
          submitLabel="Verify & continue"
          onVerified={() => {
            toast.success("Phone verified");
            navigate({ to: "/" });
          }}
        />
      </div>
    </AuthShell>
  );
}
