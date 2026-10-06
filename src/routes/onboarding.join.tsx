import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
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
import { searchSocietiesPublic, getJoinStructure, submitJoinRequestForUnit, type JoinStructure } from "@/lib/onboarding.functions";
import { supabase } from "@/integrations/supabase/client";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/onboarding/join")({
  head: () => ({ meta: [{ title: "Join society — SociyoHub" }] }),
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
  const [structure, setStructure] = useState<JoinStructure | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const hasUnits = !!structure && structure.units.length > 0;
  const usesBlocks = hasUnits && structure!.blocks.length > 0;
  const visibleUnits = hasUnits ? structure!.units.filter((u) => (usesBlocks ? u.block_id === blockId : true)) : [];
  const selectedUnit = hasUnits ? structure!.units.find((u) => u.id === unitId) ?? null : null;
  const selectedBlock = usesBlocks ? structure!.blocks.find((b) => b.id === blockId) ?? null : null;
  const unitLabel = selectedUnit ? (selectedBlock ? `${selectedBlock.name} - ${selectedUnit.label}` : selectedUnit.label) : flatNumber;
  const unitReady = hasUnits ? !!selectedUnit : !!flatNumber.trim();

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
        if (!cancelled) toast.error(userMessage(e));
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
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      toast.error(tu("op.enter_the_society_code"));
      return;
    }
    setCodeBusy(true);
    try {
      const { data, error } = await supabase.rpc("find_society_by_code", { _code: trimmed });
      if (error) throw new Error(error.message);
      const match = Array.isArray(data) ? data[0] : data;
      if (!match || match.id !== society.id) {
        toast.error(tu("op.that_code_doesn_t_match"));
        return;
      }
      const st = await getJoinStructure(society.id, trimmed);
      setStructure(st);
      setBlockId(null);
      setUnitId(null);
      setStep("details");
    } catch (e: any) {
      toast.error(userMessage(e, "Could not verify code"));
    } finally {
      setCodeBusy(false);
    }
  }

  async function submit() {
    if (!society || !role || submitting) return;
    if (!fullName.trim() || !unitReady) {
      toast.error(tu("op.please_fill_in_all_fields"));
      return;
    }
    setSubmitting(true);
    try {
      if (!selectedUnit) throw new Error("Please choose your house");
      await submitJoinRequestForUnit({
        societyId: society.id,
        code: code.trim(),
        fullName: fullName.trim(),
        blockId: selectedUnit.block_id,
        flatId: selectedUnit.id,
        mobile: verifiedPhone || null,
        ownerOrTenant: role,
      });
      toast.success(tu("nd.submitted"));
      navigate({ to: "/onboarding/pending" });
    } catch (e: any) {
      toast.error(userMessage(e, "Could not submit"));
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
        <ArrowLeft className="h-4 w-4 mr-1" /> {tu("common.back")}
      </button>

      <OnboardingStepper
        step={stepIndex}
        total={4}
        labels={["Search society", "Enter code", "Your details", "Submit"]}
      />

      {step === "search" && (
        <section className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{tu("op.find_your_society")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{tu("op.search_by_society_name_or")}</p>
          </header>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tu("op.e_g_sunrise_heights")}
              className="h-12 rounded-2xl pl-10 text-base"
            />
          </div>
          {searching && (
            <div className="text-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 inline animate-spin mr-1" /> {tu("op.searching")}
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
                      {[s.city, s.state].filter(Boolean).join(", ") || tu("op.location_not_set")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!searching && q.length >= 2 && results.length === 0 && (
              <li className="text-center text-sm text-muted-foreground py-6">{tu("op.no_societies_match")}{q}"</li>
            )}
          </ul>
          <p className="text-xs text-center text-muted-foreground pt-2">
            {tu("op.can_t_find_yours")}{" "}
            <Link to="/onboarding/create" className="text-primary font-medium">
              {tu("op.create_a_society")}
            </Link>
          </p>
        </section>
      )}

      {step === "code" && society && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society.name}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{tu("op.enter_society_code")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tu("op.ask_your_society_admin_for")}
            </p>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Label htmlFor="code" className="flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-primary" /> {tu("op.society_code")}
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
            {tu("op.continue")}
          </Button>
        </section>
      )}

      {step === "details" && society && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society.name}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{tu("op.your_details")}</h1>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{tu("auth.fullName")}</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-11 rounded-2xl"
                  placeholder={tu("op.priya_sharma")}
                />
              </div>
              {hasUnits ? (
                <>
                  {usesBlocks && (
                    <div className="space-y-2">
                      <Label>{tu("op.select_block")}</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={tu("mnt.block")}>
                        {structure!.blocks.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            role="radio"
                            aria-checked={blockId === b.id}
                            onClick={() => { setBlockId(b.id); setUnitId(null); }}
                            className={cn(
                              "min-h-11 rounded-2xl border px-3 text-sm font-medium truncate transition-colors",
                              blockId === b.id ? "border-primary bg-primary/5 text-primary" : "border-border",
                            )}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(!usesBlocks || blockId) && (
                    <div className="space-y-2">
                      <Label>{tu("op.select_house")}</Label>
                      {visibleUnits.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{tu("op.no_houses_are_set_up")}</p>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1" role="radiogroup" aria-label={tu("gd.houseLabel")}>
                          {visibleUnits.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              role="radio"
                              aria-checked={unitId === u.id}
                              onClick={() => setUnitId(u.id)}
                              className={cn(
                                "min-h-11 rounded-xl border px-2 text-sm font-medium truncate transition-colors",
                                unitId === u.id ? "border-primary bg-primary/5 text-primary" : "border-border",
                              )}
                            >
                              {u.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <p className="font-medium">{tu("op.society_setup_isn_t_finished")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tu("op.your_society_hasn_t_added")}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>{tu("op.owner_or_tenant")}</Label>
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
                  <span className="text-muted-foreground">{tu("op.verified_mobile")}</span>
                  <span className="font-medium">{verifiedPhone || "—"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Button
            onClick={() => setStep("submit")}
            disabled={!fullName.trim() || !unitReady || !role}
            className="w-full h-12 rounded-2xl"
          >
            {tu("op.continue")}
          </Button>
        </section>
      )}

      {step === "submit" && society && role && (
        <section className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{tu("op.confirm_submit")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{tu("op.your_admin_will_review_this")}</p>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Row label={tu("nav.society")} value={society.name} />
              <Row label={tu("gd.houseLabel")} value={unitLabel} />
              <Row label={tu("common.name")} value={fullName} />
              <Row label={tu("op.role")} value={role[0].toUpperCase() + role.slice(1)} />
              <Row label={tu("op.mobile")} value={verifiedPhone || "—"} />
            </CardContent>
          </Card>
          <Button disabled={submitting} onClick={submit} className="w-full h-12 rounded-2xl">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <DoorOpen className="h-4 w-4 mr-2" /> {tu("hd.submit")}
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
