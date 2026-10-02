// Guard shift session gate. The server (public._gate_society) refuses every
// guard action unless this login holds a live, unrevoked guard session, so this
// component is only the UX for that rule — never the security boundary.
// Admins act on their committee role and skip it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogOut, QrCode, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { fmtTime, gateErrorMessage } from "@/lib/visitors";

interface Status { state: "active" | "none" | "blocked" | "revoked" | "expired" | "not_guard"; expires_at?: string; reason?: string | null; needs_qr?: boolean }
const QR_RESULT: Record<string, string> = {
  invalid: "That QR isn't valid for your account.",
  expired: "That QR has expired. Ask the committee for a new one.",
  used: "That QR was already used. Ask the committee for a new one.",
  revoked: "That QR was cancelled. Ask the committee for a new one.",
};

function deviceLabel() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone / iPad" : "Browser";
}

export function GuardSessionGate({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const redeemed = useRef(false);
  const q = useQuery({
    queryKey: ["guard-session"],
    enabled: !isAdmin,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guard_session_status");
      if (error) throw error;
      return data as unknown as Status;
    },
  });

  async function redeem(raw: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("guard_redeem_entry_token", { _token: raw.trim(), _device: deviceLabel() ?? undefined });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    const r = (data as { result?: string } | null)?.result;
    if (r === "ok") { toast.success("Shift started"); setToken(""); }
    else toast.error(QR_RESULT[r ?? "invalid"] ?? QR_RESULT.invalid);
    qc.invalidateQueries();
  }

  // QR opens /app/guard?entry=<token>. Redeem once, then strip it from the URL.
  useEffect(() => {
    if (isAdmin || redeemed.current) return;
    const url = new URL(window.location.href);
    const t = url.searchParams.get("entry");
    if (!t) return;
    redeemed.current = true;
    url.searchParams.delete("entry");
    window.history.replaceState(null, "", url.pathname + url.search);
    void redeem(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function start() {
    setBusy(true);
    const { error } = await supabase.rpc("guard_start_session", { _device: deviceLabel() ?? undefined });
    setBusy(false);
    if (error) toast.error(gateErrorMessage(error)); else toast.success("Shift started");
    qc.invalidateQueries();
  }
  async function end() {
    setBusy(true);
    const { error } = await supabase.rpc("guard_end_session");
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Shift ended");
    qc.invalidateQueries();
  }

  if (isAdmin) return <>{children}</>;
  // Keep working on a known-active session during brief network loss; the server rechecks every action.
  if (q.isLoading) return <div className="py-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" aria-label="Checking your shift" /></div>;
  if (q.isError && !q.data) return (
    <Card className="rounded-2xl mx-4 my-6"><CardContent className="p-4 space-y-3">
      <p className="text-sm">We couldn't check your shift. {gateErrorMessage(q.error)}</p>
      <Button className="h-11 rounded-xl" onClick={() => q.refetch()}>Retry</Button>
    </CardContent></Card>
  );
  const s = q.data!;
  if (s.state === "active") return (
    <>
      <div className="px-4 pt-4 max-w-xl mx-auto">
        <div className="rounded-2xl border bg-success/10 px-3 py-2 flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-success shrink-0" />
          <span className="flex-1 min-w-0 truncate">Shift active · until {fmtTime(s.expires_at)}</span>
          <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={end}><LogOut className="h-4 w-4 mr-1" />End shift</Button>
        </div>
      </div>
      {children}
    </>
  );

  const needsQr = s.state === "revoked" || s.state === "blocked" || !!s.needs_qr;
  return (
    <div className="px-4 py-8 max-w-md mx-auto space-y-4">
      <Card className="rounded-2xl"><CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          {needsQr ? <ShieldOff className="h-6 w-6 text-destructive shrink-0" /> : <QrCode className="h-6 w-6 text-primary shrink-0" />}
          <div>
            <h1 className="text-lg font-semibold">{s.state === "revoked" ? "Gate session signed out" : s.state === "expired" ? "Shift expired" : needsQr ? "New QR needed" : "Start your shift"}</h1>
            <p className="text-sm text-muted-foreground">
              {s.state === "not_guard" ? "Your account doesn't have gate access."
                : needsQr ? `The committee signed out your gate access${s.reason ? ` (${s.reason})` : ""}. Scan the QR they show you with your phone camera.`
                : "Gate actions work only during an active shift on this phone. A shift lasts up to 12 hours."}
            </p>
          </div>
        </div>
        {s.state !== "not_guard" && !needsQr && (
          <Button className="w-full h-12 rounded-xl" disabled={busy} onClick={start}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Start shift"}</Button>
        )}
        {s.state !== "not_guard" && (
          <div className="space-y-2">
            <Label htmlFor="entry-token" className="text-xs text-muted-foreground">Or paste the code under the QR</Label>
            <div className="flex gap-2">
              <Input id="entry-token" className="h-11 font-mono" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
              <Button className="h-11 rounded-xl" variant="outline" disabled={busy || token.trim().length < 32} onClick={() => redeem(token)}>Use</Button>
            </div>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
