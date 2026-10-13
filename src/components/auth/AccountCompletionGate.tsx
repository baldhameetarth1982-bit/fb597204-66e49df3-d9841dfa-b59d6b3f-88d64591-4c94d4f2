import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ReverseOtpSignIn } from "@/components/auth/ReverseOtpSignIn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ROLES } from "@/config/roles";
import { tu } from "@/lib/i18n";

/**
 * Every signed-in person (resident, committee, block admin, guard) must have a
 * verified phone number and a year of birth (18+) before using the app.
 * The database enforces the same rule on creating and joining societies.
 */
export function AccountCompletionGate({ children }: { children: ReactNode }) {
  const { user, primaryRole, isLoading } = useAuth();
  const qc = useQueryClient();
  const skip = !user || primaryRole === ROLES.SUPER_ADMIN;
  const key = ["account-completion", user?.id];
  const q = useQuery({
    queryKey: key,
    enabled: !skip,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pv, pr] = await Promise.all([
        (supabase as any).from("phone_verifications").select("phone").eq("user_id", user!.id).maybeSingle(),
        (supabase as any).from("profiles").select("birth_year").eq("id", user!.id).maybeSingle(),
      ]);
      if (pv.error || pr.error) throw new Error("load_failed");
      return { phone: Boolean(pv.data?.phone), birthYear: (pr.data?.birth_year as number | null) ?? null };
    },
  });

  if (isLoading || skip) return <>{children}</>;
  // On a load failure, don't lock people out of the app; the database still enforces the rule.
  if (q.isError) return <>{children}</>;
  if (q.isLoading || !q.data) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label={tu("ln.acc.loading")} />
      </div>
    );
  }
  if (q.data.phone && q.data.birthYear) return <>{children}</>;

  const done = () => void qc.invalidateQueries({ queryKey: key });
  return (
    <div className="min-h-dvh grid place-items-center bg-secondary/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 md:p-8 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            {q.data.phone ? <CalendarDays className="h-6 w-6 text-primary" /> : <ShieldCheck className="h-6 w-6 text-primary" />}
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            {tu("ln.acc.step").replace("{{n}}", q.data.phone ? "2" : "1")}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {q.data.phone ? tu("ln.acc.ageTitle") : tu("ln.acc.phoneTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {q.data.phone ? tu("ln.acc.ageBody") : tu("ln.acc.phoneBody")}
          </p>
        </div>
        {q.data.phone ? (
          <BirthYearForm userId={user!.id} onSaved={done} />
        ) : (
          <ReverseOtpSignIn linkToCurrentUser onSignedIn={() => { toast.success(tu("op.phone_verified")); done(); }} />
        )}
      </div>
    </div>
  );
}

function BirthYearForm({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const now = new Date().getFullYear();
  const years = Array.from({ length: 93 }, (_, i) => now - 18 - i);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!year) { setError(tu("ln.acc.pickYear")); return; }
    setBusy(true); setError(null);
    const { error: e } = await (supabase as any).from("profiles").update({ birth_year: Number(year) }).eq("id", userId);
    setBusy(false);
    if (e) { setError(e.message?.includes("AGE_UNDER_18") ? tu("ln.acc.under18") : tu("ln.acc.saveFail")); return; }
    onSaved();
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
      <div className="space-y-2">
        <Label htmlFor="acc-year">{tu("ln.acc.yearLabel")}</Label>
        <select id="acc-year" value={year} onChange={(e) => setYear(e.target.value)}
          className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">{tu("ln.acc.pickYear")}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{tu("ln.acc.adultNote")}</p>
      </div>
      <Button onClick={save} disabled={busy} className="w-full min-h-11">
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} {tu("ln.acc.continue")}
      </Button>
    </div>
  );
}
