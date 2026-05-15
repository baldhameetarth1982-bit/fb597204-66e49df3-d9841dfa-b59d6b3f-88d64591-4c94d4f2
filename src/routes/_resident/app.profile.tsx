import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, Copy, Wallet, Sparkles, LifeBuoy, Share2, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { requestWithdrawal } from "@/lib/referral.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_resident/app/profile")({
  head: () => ({ meta: [{ title: "My profile — SocioHub" }] }),
  component: ProfilePage,
});

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function ProfilePage() {
  const { user, profile, roles, signOut } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState<string | null>(null);
  const [earnings, setEarnings] = useState(0);
  const [withdrawn, setWithdrawn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openWithdraw, setOpenWithdraw] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [{ data: prof }, { data: earns }, { data: wds }] = await Promise.all([
        supabase.from("profiles").select("referral_code").eq("id", user.id).maybeSingle(),
        supabase.from("referral_earnings").select("amount,status").eq("referrer_id", user.id),
        supabase.from("withdrawals").select("amount,status").eq("user_id", user.id),
      ]);
      setCode((prof?.referral_code as string) ?? null);
      setEarnings((earns ?? []).reduce((s, r: any) => s + Number(r.amount), 0));
      setWithdrawn((wds ?? [])
        .filter((w: any) => ["pending", "approved", "paid"].includes(w.status))
        .reduce((s, r: any) => s + Number(r.amount), 0));
      setLoading(false);
    })();
  }, [user]);

  const available = Math.max(0, earnings - withdrawn);
  const link = typeof window !== "undefined" && code ? `${window.location.origin}/onboarding?ref=${code}` : "";

  function copyLink() {
    navigator.clipboard.writeText(link);
    toast.success("Referral link copied");
  }
  async function shareLink() {
    if (navigator.share) {
      try { await navigator.share({ title: "Join SocioHub", url: link }); } catch { /* user cancel */ }
    } else copyLink();
  }

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>

      <Card className="rounded-2xl">
        <CardContent className="p-6 flex items-center gap-4">
          <Avatar className="h-16 w-16 ring-1 ring-border">
            <AvatarFallback className="bg-secondary text-primary font-semibold text-lg">
              {(profile?.full_name || user?.email || "U").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{profile?.full_name || "Unnamed resident"}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span key={r} className="text-[11px] rounded-full bg-secondary px-2 py-0.5 font-medium">
                  {r.replace("_", " ")}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="grid w-full grid-cols-2 rounded-2xl">
          <TabsTrigger value="account" className="rounded-xl">Account</TabsTrigger>
          <TabsTrigger value="partner" className="rounded-xl">
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Partner
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-3 mt-4">
          <Button asChild variant="outline" className="w-full h-11 rounded-xl justify-start">
            <Link to="/support"><LifeBuoy className="h-4 w-4 mr-2" /> Help & support</Link>
          </Button>
          <Button asChild variant="outline" className="w-full h-11 rounded-xl justify-start">
            <Link to="/terms">Terms of Service & Privacy</Link>
          </Button>
          <Button
            variant="outline"
            className="w-full h-11 rounded-xl text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
            onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </TabsContent>

        <TabsContent value="partner" className="space-y-4 mt-4">
          <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-wider opacity-80">Total earnings</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums">{fmt.format(earnings)}</p>
              <div className="mt-2 flex gap-4 text-xs opacity-90">
                <span>Available: <strong>{fmt.format(available)}</strong></span>
                <span>Withdrawn: <strong>{fmt.format(withdrawn)}</strong></span>
              </div>
              <Button
                className="mt-4 w-full h-11 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold"
                disabled={available <= 0 || loading}
                onClick={() => setOpenWithdraw(true)}
              >
                <Wallet className="h-4 w-4 mr-2" /> Withdraw
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your referral link
              </p>
              <div className="rounded-xl bg-secondary/60 p-3 break-all font-mono text-xs">
                {loading ? "Loading…" : link}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={copyLink} variant="outline" className="rounded-xl h-10" disabled={!code}>
                  <Copy className="h-4 w-4 mr-1" /> Copy
                </Button>
                <Button onClick={shareLink} className="rounded-xl h-10" disabled={!code}>
                  <Share2 className="h-4 w-4 mr-1" /> Share
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Earn 10% revenue share on every society that signs up using your link. Higher tiers up to 20% unlock as you refer more.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {openWithdraw && (
        <WithdrawDialog
          available={available}
          onClose={(refresh) => {
            setOpenWithdraw(false);
            if (refresh && user) {
              supabase.from("withdrawals").select("amount,status").eq("user_id", user.id)
                .then(({ data }) => setWithdrawn((data ?? [])
                  .filter((w: any) => ["pending", "approved", "paid"].includes(w.status))
                  .reduce((s, r: any) => s + Number(r.amount), 0)));
            }
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4">
      <Card className="w-full max-w-sm rounded-3xl">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Withdraw commission</h2>
          <p className="text-xs text-muted-foreground">Available: <strong>{fmt.format(available)}</strong></p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={method === "upi" ? "default" : "outline"} onClick={() => setMethod("upi")} className="rounded-xl">UPI</Button>
            <Button variant={method === "bank" ? "default" : "outline"} onClick={() => setMethod("bank")} className="rounded-xl">Bank</Button>
          </div>
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input type="number" value={amount} max={available} min={1}
              onChange={(e) => setAmount(Math.min(available, Math.max(0, Number(e.target.value))))} />
          </div>
          {method === "upi" ? (
            <div className="space-y-2">
              <Label>UPI ID</Label>
              <Input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />
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
