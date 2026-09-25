import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusChip } from "@/components/people/PeopleUI";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Copy, Wallet, LifeBuoy, Share2, Loader2, ChevronRight, Home, Users, Car, Wrench, History, ShieldCheck, Trophy, Languages, RefreshCw, FileText } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useServerFn } from "@tanstack/react-start";
import { getPartnerSummary, requestWithdrawal } from "@/lib/referral.functions";
import { toast } from "sonner";
import { LanguageSelector } from "@/components/shared/LanguageSelector";

export const Route = createFileRoute("/_resident/app/profile")({
  head: () => ({ meta: [
    { title: "Account — SociyoHub" },
    { name: "description", content: "Your profile, household, preferences and sign-in on SociyoHub." },
    { property: "og:title", content: "Account — SociyoHub" },
    { property: "og:description", content: "Manage your SociyoHub profile and household." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ProfilePage,
});

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const ROLE_LABEL: Record<string, string> = {
  resident: "Resident", society_admin: "Committee admin", block_admin: "Block admin", security: "Security", super_admin: "Platform admin",
};

function NavRow({ to, icon: Icon, label, hint }: { to: string; icon: ComponentType<{ className?: string }>; label: string; hint?: string }) {
  return (
    <li>
      <Link to={to as "/app/family"} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ProfilePage() {
  const { user, profile, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const loadPartnerSummary = useServerFn(getPartnerSummary);

  const [code, setCode] = useState<string | null>(null);
  const [earnings, setEarnings] = useState(0);
  const [withdrawn, setWithdrawn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openWithdraw, setOpenWithdraw] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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
    navigator.clipboard.writeText(link);
    toast.success("Referral link copied");
  }
  async function shareLink() {
    if (navigator.share) {
      try { await navigator.share({ title: "Join SociyoHub", url: link }); } catch { /* user cancel */ }
    } else copyLink();
  }

  const name = profile?.full_name || "Unnamed resident";
  const house = (profile as { property_number?: string | null } | null)?.property_number;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      {/* Identity */}
      <section aria-label="Your profile" className="flex items-center gap-4 rounded-2xl border bg-card p-4">
        <Avatar className="h-14 w-14 ring-1 ring-border">
          <AvatarFallback className="bg-primary-container text-primary-container-foreground font-semibold">
            {(profile?.full_name || user?.email || "U").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{name}</p>
          <p className="text-sm text-muted-foreground break-all">{user?.email}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {house && <StatusChip tone="primary"><Home className="h-3 w-3 mr-1" aria-hidden />House {house}</StatusChip>}
            {roles.map((r) => <StatusChip key={r} tone="neutral">{ROLE_LABEL[r] ?? r.replace("_", " ")}</StatusChip>)}
          </div>
        </div>
      </section>

      <Group title="Your household">
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          <NavRow to="/app/family" icon={Users} label="Family" hint="People living in your home" />
          <NavRow to="/app/vehicles" icon={Car} label="Vehicles" hint="Registered cars and bikes" />
          <NavRow to="/app/services" icon={Wrench} label="Services" hint="Help and service providers" />
        </ul>
      </Group>

      <Group title="Activity">
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          <NavRow to="/app/activity" icon={History} label="Activity" hint="Your recent actions" />
          <NavRow to="/app/trust" icon={ShieldCheck} label="Financial trust" />
          <NavRow to="/app/achievements" icon={Trophy} label="Points & leaderboard" />
        </ul>
      </Group>

      <Group title="Preferences">
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-2.5">
          <span className="flex items-center gap-3 text-sm font-medium"><Languages className="h-5 w-5 text-primary" aria-hidden />Language</span>
          <LanguageSelector compact />
        </div>
      </Group>

      <Group title="Partner programme">
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          {loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Couldn't load your partner earnings.</p>
              <Button variant="outline" className="min-h-11" onClick={() => void loadSummary()}><RefreshCw className="h-4 w-4 mr-1.5" /> Try again</Button>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="text-xs text-muted-foreground">Total earned</dt><dd className="font-semibold tabular-nums">{money(earnings)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Available</dt><dd className="font-semibold tabular-nums">{money(available)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Withdrawn</dt><dd className="font-semibold tabular-nums">{money(withdrawn)}</dd></div>
              </dl>
              <div className="rounded-xl bg-muted/60 p-3 break-all font-mono text-xs" aria-label="Your referral link">{loading ? "Loading…" : link || "—"}</div>
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={copyLink} variant="outline" className="min-h-11" disabled={!code}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
                <Button onClick={shareLink} variant="outline" className="min-h-11" disabled={!code}><Share2 className="h-4 w-4 mr-1" /> Share</Button>
                <Button className="min-h-11" disabled={available <= 0 || loading} onClick={() => setOpenWithdraw(true)}><Wallet className="h-4 w-4 mr-1" /> Withdraw</Button>
              </div>
              <p className="text-xs text-muted-foreground">Earn 10% revenue share on every society that signs up using your link. Higher tiers up to 20% unlock as you refer more.</p>
            </>
          )}
        </div>
      </Group>

      <Group title="Help & legal">
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          <NavRow to="/support" icon={LifeBuoy} label="Help & support" />
          <NavRow to="/terms" icon={FileText} label="Terms of Service & Privacy" />
        </ul>
      </Group>

      <div className="border-t pt-6">
        <Button variant="outline" className="w-full min-h-12 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive" onClick={() => setConfirmOut(true)}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>

      <AlertDialog open={confirmOut} onOpenChange={(o) => !signingOut && setConfirmOut(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of SociyoHub?</AlertDialogTitle>
            <AlertDialogDescription>You'll need to sign in again to see your bills, notices and requests.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={signingOut} onClick={async (e) => { e.preventDefault(); setSigningOut(true); await signOut(); navigate({ to: "/login" }); }}>
              {signingOut && <Loader2 className="h-4 w-4 mr-1 motion-safe:animate-spin" />} Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
      toast.success("Withdrawal requested");
      onClose(true);
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="wd-title" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4">
      <Card className="w-full max-w-sm rounded-3xl">
        <CardContent className="p-6 space-y-4">
          <h2 id="wd-title" className="text-lg font-semibold">Withdraw commission</h2>
          <p className="text-xs text-muted-foreground">Available: <strong>{fmt.format(available)}</strong></p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={method === "upi" ? "default" : "outline"} onClick={() => setMethod("upi")} className="rounded-xl">UPI</Button>
            <Button variant={method === "bank" ? "default" : "outline"} onClick={() => setMethod("bank")} className="rounded-xl">Bank</Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wd-amt">Amount</Label>
            <Input id="wd-amt" type="number" value={amount} max={available} min={1}
              onChange={(e) => setAmount(Math.min(available, Math.max(0, Number(e.target.value))))} />
          </div>
          {method === "upi" ? (
            <div className="space-y-2">
              <Label htmlFor="wd-upi">UPI ID</Label>
              <Input id="wd-upi" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2 col-span-2"><Label>Account number</Label><Input value={acct} onChange={(e) => setAcct(e.target.value)} /></div>
              <div className="space-y-2 col-span-2"><Label>IFSC</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} /></div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => onClose(false)}>Cancel</Button>
            <Button className="flex-1 rounded-xl" onClick={handle} disabled={busy || amount <= 0 || amount > available}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Request
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
