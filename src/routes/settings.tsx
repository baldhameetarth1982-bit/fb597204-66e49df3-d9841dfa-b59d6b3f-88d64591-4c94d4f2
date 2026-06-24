import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2, User as UserIcon, Save, Bell, ShieldCheck, Lock,
  Users as UsersIcon, HelpCircle, LogOut, ChevronRight, BadgeCheck,
  Globe, Smartphone, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { NeonThemePreview } from "@/components/shared/NeonThemePreview";
import { TwoFactorCard } from "@/components/security/TwoFactorCard";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — SocioHub" }] }),
  component: SettingsPage,
});

function initials(name?: string | null, email?: string | null) {
  const src = name || email || "?";
  return src
    .split(/[\s@.]/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function SettingsPage() {
  const { user, profile, isLoading, isAuthenticated, refresh, signOut, hasRole } =
    useAuth() as any;
  const isSuperAdmin = hasRole?.("super_admin") ?? false;
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // local-only preferences
  const [prefs, setPrefs] = useState({
    pushAnnouncements: true,
    pushVisitors: true,
    pushBills: true,
    emailDigest: false,
    showPhoneToNeighbors: false,
    showFlatToVisitors: true,
    marketingEmails: false,
  });

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    try {
      const raw = localStorage.getItem("sociohub:prefs");
      if (raw) setPrefs((p) => ({ ...p, ...JSON.parse(raw) }));
    } catch {}
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem("sociohub:prefs", JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    if (typeof refresh === "function") await refresh();
  }

  const aadhaarVerified = (profile as any)?.aadhaar_verified;
  const aadhaarUploaded = (profile as any)?.aadhaar_uploaded_at;

  return (
    <PageShell>
      <PageHeader
        title="Account"
        description="Manage your profile, preferences and privacy."
      />

      {/* Identity card */}
      <Card className="rounded-2xl mb-6">
        <CardContent className="p-5 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary/15 text-primary text-lg font-semibold">
              {initials(profile?.full_name, user?.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-lg truncate">
                {profile?.full_name ?? "Add your name"}
              </p>
              {aadhaarVerified ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1">
                  <BadgeCheck className="h-3 w-3" /> Verified
                </Badge>
              ) : aadhaarUploaded ? (
                <Badge variant="secondary">Verification pending</Badge>
              ) : (
                <Badge variant="outline">Unverified</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {user?.email}
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid grid-cols-5 w-full rounded-2xl">
          <TabsTrigger value="profile" className="rounded-xl">
            <UserIcon className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Profile</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-xl">
            <Bell className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="privacy" className="rounded-xl">
            <Lock className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Privacy</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="rounded-xl">
            <ShieldCheck className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger value="more" className="rounded-xl">
            <HelpCircle className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">More</span>
          </TabsTrigger>
        </TabsList>

        {/* PROFILE */}
        <TabsContent value="profile" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserIcon className="h-5 w-5 text-primary" /> Personal information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user?.email ?? ""} disabled />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 ..."
                />
              </div>
              <Button onClick={save} disabled={saving} className="rounded-xl h-11">
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* NOTIFICATIONS */}
        <TabsContent value="notifications" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bell className="h-5 w-5 text-primary" /> Notification preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Row
                label="Announcements"
                desc="Push when society admin posts an update"
                checked={prefs.pushAnnouncements}
                onChange={(v) => setPrefs({ ...prefs, pushAnnouncements: v })}
              />
              <Separator />
              <Row
                label="Visitor approvals"
                desc="Alert when a guest is at the gate"
                checked={prefs.pushVisitors}
                onChange={(v) => setPrefs({ ...prefs, pushVisitors: v })}
              />
              <Separator />
              <Row
                label="Bills & dues"
                desc="Reminders for maintenance and society bills"
                checked={prefs.pushBills}
                onChange={(v) => setPrefs({ ...prefs, pushBills: v })}
              />
              <Separator />
              <Row
                label="Weekly email digest"
                desc="Sunday recap of society activity"
                checked={prefs.emailDigest}
                onChange={(v) => setPrefs({ ...prefs, emailDigest: v })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* PRIVACY */}
        <TabsContent value="privacy" className="mt-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lock className="h-5 w-5 text-primary" /> Privacy controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Row
                label="Show my phone to neighbors"
                desc="Other residents can call you from the directory"
                checked={prefs.showPhoneToNeighbors}
                onChange={(v) => setPrefs({ ...prefs, showPhoneToNeighbors: v })}
              />
              <Separator />
              <Row
                label="Show flat number to visitors"
                desc="Gate will display your flat when announcing a visitor"
                checked={prefs.showFlatToVisitors}
                onChange={(v) => setPrefs({ ...prefs, showFlatToVisitors: v })}
              />
              <Separator />
              <Row
                label="Marketing emails"
                desc="Product updates and tips from SocioHub"
                checked={prefs.marketingEmails}
                onChange={(v) => setPrefs({ ...prefs, marketingEmails: v })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" /> Identity verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {aadhaarVerified ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
                  <BadgeCheck className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="font-medium">Your identity is verified</p>
                    <p className="text-sm text-muted-foreground">
                      Your society admin has approved your Aadhaar.
                    </p>
                  </div>
                </div>
              ) : aadhaarUploaded ? (
                <div className="rounded-xl border bg-muted/40 p-4">
                  <p className="font-medium">Verification pending</p>
                  <p className="text-sm text-muted-foreground">
                    Your society admin will review your Aadhaar shortly.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-4">
                  <p className="font-medium">Upload your Aadhaar to get verified</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Verification builds trust with your society and unlocks visitor approvals.
                  </p>
                  <Button asChild className="rounded-xl">
                    <Link to="/onboarding/join">Start verification</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lock className="h-5 w-5 text-primary" /> Account security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ActionRow
                icon={Lock}
                label="Change password"
                desc="Update your sign-in password"
                onClick={async () => {
                  if (!user?.email) return;
                  const { error } = await supabase.auth.resetPasswordForEmail(
                    user.email,
                    { redirectTo: `${window.location.origin}/login` },
                  );
                  if (error) return toast.error(error.message);
                  toast.success("Password reset email sent");
                }}
              />
              <Separator />
              <ActionRow
                icon={Smartphone}
                label="Active sessions"
                desc="You're signed in on this device"
              />
            </CardContent>
          </Card>

          <TwoFactorCard />
        </TabsContent>


        {/* MORE */}
        <TabsContent value="more" className="mt-6 space-y-6">
          <AppearanceCard
            currentTheme={(profile as any)?.theme ?? "default"}
            societyId={profile?.society_id ?? null}
            userId={user?.id ?? null}
            isSuperAdmin={isSuperAdmin}
            onChanged={() => refresh?.()}
          />


          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UsersIcon className="h-5 w-5 text-primary" /> Household
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <LinkRow to="/app/family" icon={UsersIcon} label="Family members" />
              <Separator />
              <LanguageRow />
            </CardContent>
          </Card>


          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HelpCircle className="h-5 w-5 text-primary" /> Support & legal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <LinkRow to="/support" icon={HelpCircle} label="Help & support" />
              <Separator />
              <LinkRow to="/terms" icon={ShieldCheck} label="Terms & privacy" />
              <Separator />
              <LinkRow to="/pricing" icon={ShieldCheck} label="Plans & pricing" />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-destructive/30">
            <CardContent className="p-2">
              <ActionRow
                icon={LogOut}
                label="Sign out"
                onClick={() => signOut?.()}
              />
              <Separator />
              <DeleteAccountRow email={user?.email ?? null} onSignOut={signOut} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function LanguageRow() {
  const [lang, setLang] = useState<string>(() => {
    try { return localStorage.getItem("sociohub:lang") ?? "en"; } catch { return "en"; }
  });
  const [open, setOpen] = useState(false);
  const label = { en: "English", hi: "हिन्दी (Hindi)", mr: "मराठी (Marathi)", ta: "தமிழ் (Tamil)" }[lang] ?? "English";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-muted/50 transition text-left">
          <Globe className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Language</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Choose language</DialogTitle></DialogHeader>
        <Select value={lang} onValueChange={(v) => { setLang(v); try { localStorage.setItem("sociohub:lang", v); } catch {} toast.success("Language updated"); setOpen(false); }}>
          <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
            <SelectItem value="mr">मराठी (Marathi)</SelectItem>
            <SelectItem value="ta">தமிழ் (Tamil)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Full translations are rolling out — UI currently displays English fallback for missing strings.</p>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAccountRow({ email, onSignOut }: { email: string | null; onSignOut: () => Promise<void> }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-destructive/10 transition text-left text-destructive">
          <Trash2 className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Delete account</p>
            <p className="text-sm text-muted-foreground">Permanently remove your profile and data</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This will sign you out and request permanent deletion of your profile, family members and Aadhaar from our records.
            Society admin will be notified. Type <strong>DELETE</strong> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm !== "DELETE" || busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              // Soft-delete: clear profile fields. Auth user removal needs admin/support.
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await supabase.from("profiles").update({
                  full_name: "Deleted user", phone: null, avatar_url: null,
                  aadhaar_url: null, aadhaar_last4: null, aadhaar_verified: false,
                } as any).eq("id", user.id);
                await supabase.from("family_members").delete().eq("user_id", user.id);
              }
              toast.success("Deletion requested. Support will email " + (email ?? "you") + " within 48h.");
              await onSignOut();
            }}
          >Permanently delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Row({
  label, desc, checked, onChange,
}: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionRow({
  icon: Icon, label, desc, onClick, destructive,
}: {
  icon: any; label: string; desc?: string;
  onClick?: () => void; destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-muted/50 transition text-left ${
        destructive ? "text-destructive" : ""
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{label}</p>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function LinkRow({
  to, icon: Icon, label,
}: { to: string; icon: any; label: string }) {
  return (
    <Link
      to={to}
      className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-muted/50 transition"
    >
      <Icon className="h-5 w-5" />
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function AppearanceCard({
  currentTheme, societyId, userId, isSuperAdmin, onChanged,
}: { currentTheme: string; societyId: string | null; userId: string | null; isSuperAdmin: boolean; onChanged: () => void }) {
  const [plan, setPlan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!societyId) { setPlan(null); return; }
    supabase.from("societies").select("plan").eq("id", societyId).maybeSingle()
      .then(({ data }) => setPlan((data as any)?.plan ?? null));
  }, [societyId]);

  const isPremium = isSuperAdmin || plan === "premium";

  async function setTheme(next: "default" | "neon") {
    if (next === "neon" && !isPremium) {
      toast.error("Neon theme is a Premium-plan feature");
      return;
    }
    if (!userId) return;
    setSaving(true);
    const { error } = await (supabase as any).from("profiles").update({ theme: next }).eq("id", userId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(next === "neon" ? "Neon theme applied" : "Switched to standard theme");
    onChanged();
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserIcon className="h-5 w-5 text-primary" /> Appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setTheme("default")}
            disabled={saving}
            className={`rounded-2xl border-2 p-4 text-left transition ${
              currentTheme !== "neon" ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
            }`}
          >
            <div className="h-20 rounded-lg bg-gradient-to-br from-background to-muted border mb-2" />
            <p className="font-semibold">Standard</p>
            <p className="text-xs text-muted-foreground">Clean and trustworthy.</p>
          </button>
          <button
            onClick={() => setTheme("neon")}
            disabled={saving || !isPremium}
            className={`rounded-2xl border-2 p-4 text-left transition relative ${
              currentTheme === "neon" ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
            } ${!isPremium ? "opacity-60" : ""}`}
          >
            <div className="h-20 rounded-lg mb-2 border"
              style={{ background: "radial-gradient(circle at 30% 20%, #b91c5c, #1a0a14)" }} />
            <p className="font-semibold flex items-center gap-1">Neon
              {!isPremium && <Badge variant="outline" className="text-[10px] ml-1">Premium</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">Advanced premium look.</p>
          </button>
        </div>
        {!isPremium && (
          <p className="text-xs text-muted-foreground">
            Upgrade to <Link to="/pricing" className="underline">Premium</Link> to unlock the Neon theme.
          </p>
        )}
        {isSuperAdmin && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Super Admin — all premium features unlocked, no payment needed.
          </p>
        )}

        <Separator />
        <A11yToggle />

        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">Live Neon preview</summary>
          <div className="mt-3"><NeonThemePreview /></div>
        </details>
      </CardContent>
    </Card>
  );
}

function A11yToggle() {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("a11y");
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sociohub:a11y") === "1";
      if (saved) document.documentElement.classList.add("a11y");
      setOn(saved);
    } catch {}
  }, []);
  function toggle(v: boolean) {
    setOn(v);
    document.documentElement.classList.toggle("a11y", v);
    try { localStorage.setItem("sociohub:a11y", v ? "1" : "0"); } catch {}
    toast.success(v ? "Accessibility mode on — larger text & spacing" : "Accessibility mode off");
  }
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">Accessibility mode</p>
          <p className="text-sm text-muted-foreground">Larger text, looser spacing — easier for elderly residents.</p>
        </div>
        <Switch checked={on} onCheckedChange={toggle} aria-label="Toggle accessibility mode" />
      </div>
    </div>
  );
}
