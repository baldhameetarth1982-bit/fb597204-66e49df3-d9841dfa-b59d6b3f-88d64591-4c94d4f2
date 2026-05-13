import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding/join")({
  head: () => ({ meta: [{ title: "Join society — SocioHub" }] }),
  component: JoinSociety,
});

interface Match {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

function JoinSociety() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [joining, setJoining] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Please enter all 6 characters");
      return;
    }
    setVerifying(true);
    setMatch(null);
    const { data, error } = await supabase.rpc("find_society_by_code", {
      _code: code.toUpperCase(),
    });
    setVerifying(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = (data ?? [])[0];
    if (!row) {
      toast.error("No society found for this code");
      return;
    }
    setMatch(row as Match);
  }

  async function handleConfirm() {
    if (!match) return;
    if (!agreed) { toast.error("Please accept the Terms of Service"); return; }
    setJoining(true);
    const { error } = await supabase.rpc("join_society_with_code", {
      _code: code.toUpperCase(),
    });
    setJoining(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
    toast.success(`Joined ${match.name}`);
    navigate({ to: "/app/dashboard" });
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
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Join your society</h1>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit invite code shared by your society admin.
        </p>
      </header>

      <Card className="rounded-3xl">
        <CardContent className="p-5">
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Invite code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => {
                  setMatch(null);
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
                }}
                placeholder="e.g. 4F9K2X"
                maxLength={6}
                className="h-12 rounded-xl text-center tracking-[0.5em] text-lg font-semibold uppercase"
              />
            </div>
            {!match ? (
              <Button type="submit" disabled={verifying} className="w-full h-12 rounded-xl">
                {verifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify code
              </Button>
            ) : null}
          </form>

          {match && (
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">{match.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[match.city, match.state].filter(Boolean).join(", ") || "Location not set"}
                  </p>
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground px-1">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary" />
                <span>
                  I agree to the{" "}
                  <Link to="/terms" target="_blank" className="text-primary underline">
                    Terms of Service &amp; Privacy Policy
                  </Link>
                </span>
              </label>
              <Button
                onClick={handleConfirm}
                disabled={joining || !agreed}
                className="w-full h-12 rounded-xl"
              >
                {joining && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm &amp; Join
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMatch(null)}
                className="w-full h-10 rounded-xl"
              >
                Wrong society? Try another code
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground">
        Don't have a code? Ask your admin or{" "}
        <Link to="/onboarding/create" className="text-primary font-medium">
          create a society
        </Link>
        .
      </p>
    </div>
  );
}
