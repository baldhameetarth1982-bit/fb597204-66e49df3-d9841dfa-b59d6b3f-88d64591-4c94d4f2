import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Loader2, LogOut, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { tu } from "@/lib/i18n";
import { guardShiftError } from "@/lib/guard-shift";
import { askConfirm } from "@/components/system/AskTextDialog";

export const Route = createFileRoute("/onboarding/guard")({
  head: () => ({ meta: [{ title: "Join as a guard — SociyoHub" }, { name: "robots", content: "noindex" }] }),
  component: GuardJoin,
});

interface GuardReq { id: string; status: "pending" | "approved" | "rejected" | "cancelled"; reason: string | null; created_at: string; full_name: string }

function GuardJoin() {
  const { isLoading, isAuthenticated, profile, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);

  useEffect(() => { if (profile?.full_name && !name) setName(profile.full_name); }, [profile?.full_name, name]);

  const q = useQuery({
    enabled: !!profile?.id && !profile?.society_id,
    queryKey: ["my-guard-join-request", profile?.id],
    refetchInterval: (query) => ((query.state.data as GuardReq | null | undefined)?.status === "pending" ? 8000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.from("guard_join_requests")
        .select("id, status, reason, created_at, full_name")
        .eq("user_id", profile!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as GuardReq | null;
    },
  });

  useEffect(() => {
    if (q.data?.status !== "approved") return;
    void (async () => { await refresh(); navigate({ to: "/app/guard", replace: true }); })();
  }, [q.data?.status, navigate, refresh]);

  if (isLoading) return <Center />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (profile?.society_id) return <Navigate to="/onboarding" search={{} as never} replace />;
  if (q.isLoading) return <Center />;

  async function submit() {
    setBusy(true);
    const { error } = await supabase.rpc("submit_guard_join_request", { _code: code.trim(), _full_name: name.trim() });
    setBusy(false);
    if (error) return toast.error(guardShiftError(error) ?? tu("ln.acc.saveFail"));
    toast.success(tu("ln.gj.sent"));
    setRetry(false);
    qc.invalidateQueries({ queryKey: ["my-guard-join-request"] });
  }
  async function cancel() {
    if (!(await askConfirm(tu("ln.gj.cancelConfirm")))) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_guard_join_request");
    setBusy(false);
    if (error) return toast.error(tu("ln.acc.saveFail"));
    qc.invalidateQueries({ queryKey: ["my-guard-join-request"] });
  }

  const req = q.data;
  const signOutBtn = (
    <Button variant="ghost" onClick={signOut} className="w-full h-11 rounded-2xl"><LogOut className="h-4 w-4 mr-2" />{tu("common.signOut")}</Button>
  );

  if (req?.status === "pending") return (
    <div className="px-5 py-8 space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10"><Clock className="h-8 w-8 text-primary" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{tu("ln.gj.pendingTitle")}</h1>
        <p className="text-sm text-muted-foreground">{tu("ln.gj.pendingBody")}</p>
      </div>
      <Button variant="outline" disabled={busy} onClick={cancel} className="w-full h-11 rounded-2xl">{tu("ln.gj.cancel")}</Button>
      {signOutBtn}
    </div>
  );

  if (req?.status === "rejected" && !retry) return (
    <div className="px-5 py-8 space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10"><XCircle className="h-8 w-8 text-destructive" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{tu("ln.gj.rejectedTitle")}</h1>
        {req.reason && <p className="text-sm text-muted-foreground">{tu("op.reason")} {req.reason}</p>}
      </div>
      <Button onClick={() => setRetry(true)} className="w-full h-12 rounded-2xl">{tu("ln.gj.tryAgain")}</Button>
      {signOutBtn}
    </div>
  );

  return (
    <div className="px-5 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center"><ShieldCheck className="h-6 w-6 text-primary" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{tu("ln.gj.title")}</h1>
        <p className="text-sm text-muted-foreground">{tu("ln.gj.body")}</p>
      </header>
      <Card className="rounded-3xl"><CardContent className="p-5 space-y-4 sm:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="gj-code">{tu("ln.gj.code")}</Label>
          <Input id="gj-code" className="h-12 font-mono uppercase tracking-widest" autoComplete="off" maxLength={16}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gj-name">{tu("ln.gj.name")}</Label>
          <Input id="gj-name" className="h-12" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button className="w-full h-12 rounded-2xl" disabled={busy || code.length < 4 || name.trim().length < 2} onClick={submit}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : tu("ln.gj.submit")}
        </Button>
      </CardContent></Card>
      <Button asChild variant="ghost" className="w-full h-11 rounded-2xl"><Link to="/onboarding" search={{} as never}>{tu("common.back")}</Link></Button>
    </div>
  );
}

const Center = () => <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
