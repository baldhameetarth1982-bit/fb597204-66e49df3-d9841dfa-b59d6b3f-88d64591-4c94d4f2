import { createFileRoute, Link, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft, Search, Loader2, CheckCircle2, Building2, DoorOpen,
  User, Key, Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding/join")({
  head: () => ({ meta: [{ title: "Join society — SocioHub" }] }),
  component: JoinFlow,
});

type Society = { id: string; name: string; city: string | null; state: string | null };
type Flat = { flat_id: string; flat_number: string; floor: number | null; block_id: string | null; block_name: string | null; is_occupied: boolean };
type Step = "search" | "flat" | "relation" | "confirm";

function JoinFlow() {
  const { isLoading, isAuthenticated, profile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Society[]>([]);
  const [searching, setSearching] = useState(false);
  const [society, setSociety] = useState<Society | null>(null);

  const [flats, setFlats] = useState<Flat[]>([]);
  const [loadingFlats, setLoadingFlats] = useState(false);
  const [flatQuery, setFlatQuery] = useState("");
  const [flat, setFlat] = useState<Flat | null>(null);

  const [relationship, setRelationship] = useState<"owner" | "tenant" | "family" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (profile?.society_id) return <Navigate to="/app/dashboard" replace />;

  async function doSearch(value: string) {
    setSearching(true);
    const { data, error } = await supabase.rpc("search_societies_by_name", { _q: value });
    setSearching(false);
    if (error) { toast.error(error.message); return; }
    setResults((data ?? []) as Society[]);
  }

  async function pickSociety(s: Society) {
    setSociety(s);
    setStep("flat");
    setLoadingFlats(true);
    const { data, error } = await supabase.rpc("list_society_flats_public", { _society_id: s.id });
    setLoadingFlats(false);
    if (error) { toast.error(error.message); return; }
    setFlats((data ?? []) as Flat[]);
  }

  async function submit() {
    if (!flat || !relationship) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("request_join_flat", {
      _flat_id: flat.flat_id,
      _relationship: relationship,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Request submitted");
    navigate({ to: "/onboarding/pending" });
  }

  const filteredFlats = flats.filter((f) => {
    if (!flatQuery) return true;
    const t = flatQuery.toLowerCase();
    return (
      f.flat_number.toLowerCase().includes(t) ||
      (f.block_name ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <div className="px-5 py-5 space-y-5">
      <button
        onClick={() => {
          if (step === "search") navigate({ to: "/onboarding" });
          else if (step === "flat") setStep("search");
          else if (step === "relation") setStep("flat");
          else setStep("relation");
        }}
        className="inline-flex items-center text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </button>

      <Stepper step={step} />

      {step === "search" && (
        <section className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Find your society</h1>
            <p className="mt-1 text-sm text-muted-foreground">Search by society name or city.</p>
          </header>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (e.target.value.trim().length >= 2) doSearch(e.target.value);
                else setResults([]);
              }}
              placeholder="e.g. Sunrise Heights"
              className="h-12 rounded-2xl pl-10 text-base"
            />
          </div>
          {searching && <div className="text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 inline animate-spin mr-1" /> Searching…</div>}
          <ul className="space-y-2">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => pickSociety(s)}
                  className="w-full text-left rounded-2xl border border-border bg-card p-4 flex items-start gap-3 active:scale-[0.99] transition-transform"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
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
            Can't find yours? <Link to="/onboarding/create" className="text-primary font-medium">Create a society</Link>
          </p>
        </section>
      )}

      {step === "flat" && society && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society.name}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Pick your flat</h1>
          </header>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={flatQuery}
              onChange={(e) => setFlatQuery(e.target.value)}
              placeholder="Search flat or block"
              className="h-11 rounded-2xl pl-9"
            />
          </div>
          {loadingFlats ? (
            <div className="text-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading flats…</div>
          ) : flats.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="p-5 text-center text-sm text-muted-foreground">
              This society hasn't added any flats yet. Ask the admin to set them up first.
            </CardContent></Card>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {filteredFlats.map((f) => (
                <li key={f.flat_id}>
                  <button
                    onClick={() => { setFlat(f); setStep("relation"); }}
                    className="w-full rounded-2xl border border-border bg-card p-3 text-left active:scale-[0.97] transition-transform"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-foreground">
                      <DoorOpen className="h-4 w-4" />
                    </span>
                    <span className="block mt-2 font-semibold text-sm leading-tight">{f.flat_number}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {f.block_name ?? "—"}{f.floor != null ? ` · Floor ${f.floor}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === "relation" && flat && (
        <section className="space-y-4">
          <header>
            <p className="text-xs text-muted-foreground">{society?.name} · {flat.block_name ?? ""} {flat.flat_number}</p>
            <h1 className="text-2xl font-semibold tracking-tight">You live here as…</h1>
          </header>
          <div className="grid gap-3">
            {[
              { v: "owner", label: "Owner", desc: "You own this flat", Icon: Key },
              { v: "tenant", label: "Tenant", desc: "You rent this flat", Icon: User },
              { v: "family", label: "Family member", desc: "You live with the owner/tenant", Icon: UsersIcon },
            ].map(({ v, label, desc, Icon }) => (
              <button
                key={v}
                onClick={() => setRelationship(v as any)}
                className={cn(
                  "w-full rounded-2xl border p-4 text-left flex items-center gap-3 transition-colors",
                  relationship === v ? "border-primary bg-primary/5" : "border-border bg-card",
                )}
              >
                <span className={cn("grid h-11 w-11 place-items-center rounded-xl",
                  relationship === v ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{desc}</span>
                </span>
                {relationship === v && <CheckCircle2 className="h-5 w-5 text-primary" />}
              </button>
            ))}
          </div>
          <Button
            disabled={!relationship}
            onClick={() => setStep("confirm")}
            className="w-full h-12 rounded-2xl"
          >
            Continue
          </Button>
        </section>
      )}

      {step === "confirm" && flat && society && relationship && (
        <section className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Confirm & submit</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your society admin will review and approve.</p>
          </header>
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <Row label="Society" value={society.name} />
              <Row label="Block" value={flat.block_name ?? "—"} />
              <Row label="Flat" value={flat.flat_number} />
              <Row label="Floor" value={flat.floor != null ? `${flat.floor}` : "—"} />
              <Row label="Relationship" value={relationship[0].toUpperCase() + relationship.slice(1)} />
            </CardContent>
          </Card>
          <Button disabled={submitting} onClick={submit} className="w-full h-12 rounded-2xl">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit request
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

function Stepper({ step }: { step: Step }) {
  const idx = { search: 0, flat: 1, relation: 2, confirm: 3 }[step];
  return (
    <div className="flex items-center gap-1.5">
      {[0,1,2,3].map((i) => (
        <span key={i} className={cn(
          "h-1.5 flex-1 rounded-full transition-colors",
          i <= idx ? "bg-primary" : "bg-secondary",
        )}/>
      ))}
    </div>
  );
}
