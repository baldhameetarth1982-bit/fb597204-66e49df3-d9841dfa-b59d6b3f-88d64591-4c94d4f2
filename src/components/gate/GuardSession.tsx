// Guard shift session gate. The server (public._gate_society) refuses every
// guard action unless this login holds a live, unrevoked guard session, so this
// component is only the UX for that rule — never the security boundary.
// Admins act on their committee role and skip it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, LogOut, QrCode, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { fmtTime, gateErrorMessage } from "@/lib/visitors";

interface Status { state: "active" | "none" | "blocked" | "revoked" | "expired" | "not_guard"; expires_at?: string; reason?: string | null; needs_qr?: boolean }
const QR_RESULT = new Set(["invalid", "expired", "used", "revoked"]);

function deviceLabel() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone / iPad" : "Browser";
}

export function GuardSessionGate({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  const { t } = useTranslation();
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
    if (r === "ok") { toast.success(t("gs.started")); setToken(""); }
    else toast.error(t(`gs.qr.${r && QR_RESULT.has(r) ? r : "invalid"}`));
    qc.invalidateQueries();
  }

  // QR opens /app/guard?entry=<token>. Redeem once, then strip it from the URL.
  useEffect(() => {
    if (isAdmin || redeemed.current) return;
    const url = new URL(window.location.href);
    const entry = url.searchParams.get("entry");
    if (!entry) return;
    redeemed.current = true;
    url.searchParams.delete("entry");
    window.history.replaceState(null, "", url.pathname + url.search);
    void redeem(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function start() {
    setBusy(true);
    const { error } = await supabase.rpc("guard_start_session", { _device: deviceLabel() ?? undefined });
    setBusy(false);
    if (error) toast.error(gateErrorMessage(error)); else toast.success(t("gs.started"));
    qc.invalidateQueries();
  }
  async function end() {
    setBusy(true);
    const { error } = await supabase.rpc("guard_end_session");
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(t("gs.ended"));
    qc.invalidateQueries();
  }

  if (isAdmin) return <>{children}</>;
  // Keep working on a known-active session during brief network loss; the server rechecks every action.
  if (q.isLoading) return <div className="py-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" aria-label={t("gs.checking")} /></div>;
  if (q.isError && !q.data) return (
    <Card className="rounded-2xl mx-4 my-6"><CardContent className="p-4 space-y-3">
      <p className="text-sm">{t("gs.checkFailed")} {gateErrorMessage(q.error)}</p>
      <Button className="h-11 rounded-xl" onClick={() => q.refetch()}>{t("common.retry")}</Button>
    </CardContent></Card>
  );
  const s = q.data!;
  if (s.state === "active") return (
    <>
      <div className="px-4 pt-4 max-w-xl mx-auto">
        <div className="rounded-2xl border bg-success/10 px-3 py-2 flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-success shrink-0" />
          <span className="flex-1 min-w-0 truncate">{t("gs.activeUntil", { time: fmtTime(s.expires_at) })}</span>
          <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={end}><LogOut className="h-4 w-4 mr-1" />{t("gs.end")}</Button>
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
            <h1 className="text-lg font-semibold">{s.state === "revoked" ? t("gs.revoked") : s.state === "expired" ? t("gs.expired") : needsQr ? t("gs.needQr") : t("gs.startTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {s.state === "not_guard" ? t("gs.notGuard")
                : needsQr ? `${t("gs.signedOut")}${s.reason ? ` ${t("cm.reason")}: ${s.reason}.` : ""} ${t("gs.scanQr")}`
                : t("gs.hint")}
            </p>
          </div>
        </div>
        {s.state !== "not_guard" && !needsQr && (
          <Button className="w-full h-12 rounded-xl" disabled={busy} onClick={start}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("gs.start")}</Button>
        )}
        {s.state !== "not_guard" && (
          <div className="space-y-2">
            <Label htmlFor="entry-token" className="text-xs text-muted-foreground">{t("gs.pasteCode")}</Label>
            <div className="flex gap-2">
              <Input id="entry-token" className="h-11 font-mono" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
              <Button className="h-11 rounded-xl" variant="outline" disabled={busy || token.trim().length < 32} onClick={() => redeem(token)}>{t("gs.use")}</Button>
            </div>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
