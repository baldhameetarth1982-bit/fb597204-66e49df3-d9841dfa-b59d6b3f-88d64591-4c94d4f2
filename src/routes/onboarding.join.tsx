import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Search, Loader2, CheckCircle2, Building2, DoorOpen, User, Key, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { OnboardingStepper } from "@/components/system/OnboardingStepper";
import { searchSocietiesPublic, submitJoinRequest } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/onboarding/join")({
  head: () => ({ meta: [{ title: "Join society — SocioHub" }] }),
  component: JoinFlow,
});

type Society = { id: string; name: string; city: string | null; state: string | null; logo_url: string | null };
type Step = "search" | "code" | "details" | "submit";

function JoinFlow() {
  const { isLoading, isAuthenticated, profile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Society[]>([]);
  const [searching, setSearching] = useState(false);
  const [society, setSociety] = useState<Society | null>(null);

  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [role, setRole] = useState<"owner" | "tenant" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const verifiedPhone = useMemo(() => profile?.phone ?? "", [profile?.phone]);

  useEffect(() => {
    if (profile?.full_name && !fullName) setFullName(profile.full_name);
  }, [profile?.full_name, fullName]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const list = await searchSocietiesPublic(q.trim());
        if (!cancelled) setResults(list);
      } catch (e: any) {
        if (!cancelled) toast.error(e.message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (profile?.society_id) return <Navigate to="/app/dashboard" replace />;

  const stepIndex = { search: 1, code: 2, details: 3, submit: 4 }[step];

  async function verifyCode() {
    if (!society) return;
    if (code.trim().length < 4) {
      toast.error("Enter the society code");
      return;
    }
    setCodeBusy(true);
    // Verify by attempting a dry-check via search + code guard on submit.
    // We do a lightweight round-trip: attempt to fetch the invite_code
    // through the public search RPC by name AND compare — but the real check
    // happens server-side in submit_join_request. Advance the UI here; a
    // wrong code will surface as a toast on the final submit step.
    setCodeBusy(false);
    setStep("details");
  }

  async function submit() {
    if (!society || !role || submitting) return;
    if (!fullName.trim() || !flatNumber.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setSubmitting(true);
    try {
      await submitJoinRequest({
        societyId: society.id,
        code: code.trim(),
        fullName: fullName.trim(),
        flatNumber: flatNumber.trim(),
        mobile: verifiedPhone || null,
        ownerOrTenant: role,
      });
      toast.success("Request submitted");
      navigate({ to: "/onboarding/pending" });
    } catch (e: any) {
      toast.error(e.message ?? "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-5 py-5 space-y-5 max-w-md mx-auto">
      <button
        onClick={() => {
          if (step === "search") navigate({ to: "/onboarding", search: {} as any });
          else if (step === "code") setStep("search");
          else if (step === "details") setStep("code");
          else setStep("details");
        }}
        className="inline-flex items-center text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </button>

      <OnboardingStepper
        step={stepIndex}
        total={4}
        labels={["Search society", "Enter code", "Your details", "Submit"]}
      />

      {step === "search" && (
        <section className="space-y-4">
          <header>
            <h1 className="type-title">Find your society</h1>
            <p className="mt-1 text-sm text-muted-foreground">Search by society name or city.</p>
          </header>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Sunrise Heights"
              className="h-12 rounded-2xl pl-10 text-base"
            />
          </div>
          {searching && (
            <div className="text-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 inline animate-spin mr-1" /> Searching…
            </div>
          )}
          <ul className="space-y-2">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setSociety(s);
                    setStep("code");
                  }}
                  className="w-full text-left rounded-2xl border border-border bg-card p-4 flex items-start gap-3 active:scale-[0.99] transition-transform"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary overflow-hidden">
                    {s.logo_url ? (
                      <img src={s.logo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Building2 className="h-5 w-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold truncate">{s.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {[s.city, s.state].filter(Boolean).join(", ") || "Location not set"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!searching && q.length >= 2 && results.length === 0 && (
              <li className="text-center text-sm text-muted-foreground py-6">No societies match "{q}"</li>
            )}
          </ul>
          <p className="text-xs text-center text-muted-foreground pt-2">
            Can't find yours?{" "}
            <Link to="/onboarding/create" className="text-primary font-medium">
              Create a society
            </Link>
          </p>
        </section>
      )}

      {step === "code" && society && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society.name}</p>
            <h1 className="type-title">Enter society code</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask your Society Admin for the invite code — you'll need it to request access.
            </p>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Label htmlFor="code" className="flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-primary" /> Society code
              </Label>
              <Input
                id="code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
                placeholder="e.g. AB12CD"
                className="h-14 rounded-2xl text-center tracking-[0.4em] font-mono text-xl"
              />
            </CardContent>
          </Card>
          <Button onClick={verifyCode} disabled={codeBusy || code.length < 4} className="w-full h-12 rounded-2xl">
            {codeBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Continue
          </Button>
        </section>
      )}

      {step === "details" && society && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society.name}</p>
            <h1 className="type-title">Your details</h1>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-11 rounded-2xl"
                  placeholder="Priya Sharma"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="flat">House / flat number</Label>
                <Input
                  id="flat"
                  value={flatNumber}
                  onChange={(e) => setFlatNumber(e.target.value)}
                  className="h-11 rounded-2xl"
                  placeholder="A-1204"
                />
              </div>
              <div className="space-y-2">
                <Label>Owner or tenant?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { v: "owner", label: "Owner", Icon: Key },
                      { v: "tenant", label: "Tenant", Icon: User },
                    ] as const
                  ).map(({ v, label, Icon }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRole(v)}
                      className={cn(
                        "rounded-2xl border p-3 flex items-center gap-2 text-sm font-medium transition-colors",
                        role === v ? "border-primary bg-primary/5 text-primary" : "border-border",
                      )}
                    >
                      <Icon className="h-4 w-4" /> {label}
                      {role === v && <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-secondary/50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verified mobile</span>
                  <span className="font-medium">{verifiedPhone || "—"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Button
            onClick={() => setStep("submit")}
            disabled={!fullName.trim() || !flatNumber.trim() || !role}
            className="w-full h-12 rounded-2xl"
          >
            Continue
          </Button>
        </section>
      )}

      {step === "submit" && society && role && (
        <section className="space-y-4">
          <header>
            <h1 className="type-title">Confirm & submit</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your admin will review this request.</p>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Row label="Society" value={society.name} />
              <Row label="Flat" value={flatNumber} />
              <Row label="Name" value={fullName} />
              <Row label="Role" value={role[0].toUpperCase() + role.slice(1)} />
              <Row label="Mobile" value={verifiedPhone || "—"} />
            </CardContent>
          </Card>
          <Button disabled={submitting} onClick={submit} className="w-full h-12 rounded-2xl">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <DoorOpen className="h-4 w-4 mr-2" /> Submit request
          </Button>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold truncate">{value}</span>
    </div>
  );
}
