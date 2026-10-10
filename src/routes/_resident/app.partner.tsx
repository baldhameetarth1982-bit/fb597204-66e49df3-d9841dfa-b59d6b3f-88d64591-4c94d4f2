import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Wallet, Share2, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useServerFn } from "@tanstack/react-start";
import { getPartnerSummary, requestWithdrawal } from "@/lib/referral.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_resident/app/partner")({
  head: () => ({ meta: [
    { title: "Partner programme — SociyoHub" },
    { name: "description", content: "Share your SociyoHub link, see what you've earned and request a withdrawal." },
    { property: "og:title", content: "Partner programme — SociyoHub" },
    { property: "og:description", content: "Refer societies to SociyoHub and track your earnings." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: PartnerPage,
});

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Partner programme (moved out of Profile: Profile holds account settings only). */
function PartnerPage() {
  const { user } = useAuth();
  const loadPartnerSummary = useServerFn(getPartnerSummary);
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [earnings, setEarnings] = useState(0);
  const [withdrawn, setWithdrawn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openWithdraw, setOpenWithdraw] = useState(false);

  async function loadSummary() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const summary = await loadPartnerSummary();
      setCode(summary.referral_code ?? null);
      setEarnings(Number(summary.total_earnings ?? 0));
      setWithdrawn(Number(summary.pending_withdrawals ?? 0));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const available = Math.max(0, earnings - withdrawn);
  const link = typeof window !== "undefined" && code ? `${window.location.origin}/onboarding?ref=${code}` : "";
  const money = (n: number) => (loading || loadFailed ? "—" : fmt.format(n));

  function copyLink() {
    void navigator.clipboard.writeText(link).then(() => toast.success(t("prof.linkCopied")), () => toast.error(t("prof.copyFailed")));
  }
  async function shareLink() {
    if (navigator.share) {
      try { await navigator.share({ title: t("prof.shareTitle"), url: link }); } catch { /* user cancel */ }
    } else copyLink();
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("prof.g.partner")}</h1>
      <section aria-label={t("prof.g.partner")}>
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          {loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">{t("prof.partnerFailed")}</p>
              <Button variant="outline" className="min-h-11" onClick={() => void loadSummary()}><RefreshCw className="h-4 w-4 mr-1.5" /> {t("common.tryAgain")}</Button>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="text-xs text-muted-foreground">{t("prof.totalEarned")}</dt><dd className="font-semibold tabular-nums">{money(earnings)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("prof.available")}</dt><dd className="font-semibold tabular-nums">{money(available)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("prof.withdrawn")}</dt><dd className="font-semibold tabular-nums">{money(withdrawn)}</dd></div>
              </dl>
              <div className="rounded-xl bg-muted/60 p-3 break-all font-mono text-xs" aria-label={t("prof.referralLink")}>{loading ? t("common.loading") : link || "—"}</div>
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={copyLink} variant="outline" className="min-h-11" disabled={!code}><Copy className="h-4 w-4 mr-1" /> {t("sd.copy")}</Button>
                <Button onClick={shareLink} variant="outline" className="min-h-11" disabled={!code}><Share2 className="h-4 w-4 mr-1" /> {t("prof.share")}</Button>
                <Button className="min-h-11" disabled={available <= 0 || loading} onClick={() => setOpenWithdraw(true)}><Wallet className="h-4 w-4 mr-1" /> {t("prof.withdraw")}</Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("prof.partnerInfo")}</p>
            </>
          )}
        </div>
      </section>

      {openWithdraw && (
        <WithdrawDialog
          available={available}
          onClose={(refresh) => {
            setOpenWithdraw(false);
            if (refresh && user) void loadSummary();
          }}
        />
      )}
    </div>
  );
}

function WithdrawDialog({ available, onClose }: { available: number; onClose: (refresh: boolean) => void }) {
  const submit = useServerFn(requestWithdrawal);
  const { t } = useTranslation();
  const [method, setMethod] = useState<"upi" | "bank">("upi");
  const [amount, setAmount] = useState<number>(Math.min(500, available));
  const [upi, setUpi] = useState("");
  const [acct, setAcct] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await submit({ data: { amount, method, upi_id: method === "upi" ? upi : undefined, bank_account: method === "bank" ? acct : undefined, bank_ifsc: method === "bank" ? ifsc : undefined } });
      toast.success(t("prof.wd.done"));
      onClose(true);
    } catch (e: any) {
      toast.error(userMessage(e, t("prof.wd.failed")));
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="wd-title" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4">
      <Card className="w-full max-w-sm rounded-3xl">
        <CardContent className="p-6 space-y-4">
          <h2 id="wd-title" className="text-lg font-semibold">{t("prof.wd.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("prof.wd.available", { amount: fmt.format(available) })}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={method === "upi" ? "default" : "outline"} onClick={() => setMethod("upi")} className="rounded-xl">UPI</Button>
            <Button variant={method === "bank" ? "default" : "outline"} onClick={() => setMethod("bank")} className="rounded-xl">{t("rep.bank")}</Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wd-amt">{t("common.amount")}</Label>
            <Input id="wd-amt" type="number" value={amount} max={available} min={1}
              onChange={(e) => setAmount(Math.min(available, Math.max(0, Number(e.target.value))))} />
          </div>
          {method === "upi" ? (
            <div className="space-y-2">
              <Label htmlFor="wd-upi">{t("prof.wd.upiId")}</Label>
              <Input id="wd-upi" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2 col-span-2"><Label>{t("prof.wd.account")}</Label><Input aria-label={t("prof.wd.account")} value={acct} onChange={(e) => setAcct(e.target.value)} /></div>
              <div className="space-y-2 col-span-2"><Label>IFSC</Label><Input aria-label="IFSC" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} /></div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => onClose(false)}>{t("common.cancel")}</Button>
            <Button className="flex-1 rounded-xl" onClick={handle} disabled={busy || amount <= 0 || amount > available}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("prof.wd.request")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
