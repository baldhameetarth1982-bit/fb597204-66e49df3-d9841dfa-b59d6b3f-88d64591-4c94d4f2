import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { WizardRunner } from "@/features/onboarding/wizard/WizardRunner";
import {
  buildSocietySetupWizard, type WizardState,
} from "@/features/onboarding/wizard/societySetup";
import { commitSocietyWizard, loadWizardDraft } from "@/lib/hierarchy.functions";
import { createSocietyFull } from "@/lib/onboarding.functions";
import { PhoneOtpForm } from "@/components/auth/PhoneOtpForm";

export const Route = createFileRoute("/onboarding/create")({
  head: () => ({ meta: [{ title: "Create society — SociyoHub" }] }),
  component: CreateSocietyWizardPage,
});

function CreateSocietyWizardPage() {
  const { isLoading, isAuthenticated, user, profile } = useAuth();
  const navigate = useNavigate();
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [initialState, setInitialState] = useState<Partial<WizardState> | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Society admins must have a verified phone before creating a society.
      const { data: pv } = await (supabase as any)
        .from("phone_verifications")
        .select("phone")
        .eq("user_id", user.id)
        .maybeSingle();
      const verified = Boolean(pv?.phone);
      setPhoneVerified(verified);
      if (!verified) {
        setBootstrapping(false);
        return;
      }

      // 1. If admin already has a society, resume its wizard draft
      const { data: role } = await supabase
        .from("user_roles")
        .select("society_id")
        .eq("user_id", user.id)
        .eq("role", "society_admin")
        .not("society_id", "is", null)
        .limit(1)
        .maybeSingle();
      let sid = role?.society_id as string | null;

      if (sid) {
        const { data: settings } = await supabase
          .from("society_settings")
          .select("setup_completed_at")
          .eq("society_id", sid)
          .maybeSingle();
        if (settings?.setup_completed_at) {
          navigate({ to: "/onboarding/plan" });
          return;
        }
        const draft = await loadWizardDraft(sid);
        if (draft && typeof draft === "object" && "state" in draft) {
          setInitialState((draft as { state: WizardState }).state);
        }
      } else {
        // 2. No society yet — create a shell so autosave has somewhere to land
        try {
          const created = await createSocietyFull({
            name: `${profile?.full_name ?? "My"} Society`,
          });
          sid = created.id;
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not start setup");
        }
      }
      setSocietyId(sid ?? null);
      setBootstrapping(false);
    })();
  }, [user, navigate, profile?.full_name]);

  if (isLoading || bootstrapping) {
    return (
      <div className="min-h-dvh grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (phoneVerified === false) {
    return (
      <div className="min-h-dvh grid place-items-center bg-secondary/40 p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 md:p-8 shadow-sm">
          <div className="text-center space-y-2">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Verify your phone</h1>
            <p className="text-sm text-muted-foreground">
              Society admins must verify a mobile number before creating a society.
              This is used for approvals and resident communication.
            </p>
          </div>
          <div className="mt-6">
            <PhoneOtpForm
              linkToCurrentUser
              submitLabel="Verify & continue"
              onVerified={() => {
                toast.success("Phone verified");
                window.location.reload();
              }}
            />
          </div>
        </div>
      </div>
    );
  }
  if (!societyId) {
    return (
      <div className="min-h-dvh grid place-items-center text-muted-foreground p-6 text-center">
        Could not initialise setup. Please refresh.
      </div>
    );
  }

  const def = buildSocietySetupWizard();

  return (
    <WizardRunner
      def={def}
      societyId={societyId}
      initialState={initialState ?? undefined}
      finishLabel="Finish setup"
      onComplete={async (state) => {
        // Build payload — flatten unit code/name/floor fields for the RPC
        await commitSocietyWizard(societyId, {
          info: state.info,
          layout: state.layout,
          structure_label: state.structure_label,
          structures: state.structures.map((s) => ({
            name: s.name, code: s.code,
            floors: s.floors, units_per_floor: s.units_per_floor,
            ground_floor: s.ground_floor,
            numbering_format: s.numbering_format,
            custom_pattern: s.custom_pattern,
            units: s.units,
          })),
          serial_units: state.serial_units,
          opening: state.opening,
          maintenance: state.maintenance,
          dynamic_fields: state.dynamic_fields,
          financial_year_label: state.financial_year_label,
        });
        toast.success("Society setup complete");
        navigate({ to: "/onboarding/plan" });
      }}
    />
  );
}
