import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useEffect, useState } from "react";
import {
  Loader2, User as UserIcon, Save, Bell, ShieldCheck, Lock,
  Users as UsersIcon, HelpCircle, LogOut, ChevronRight, BadgeCheck,
  Globe, Smartphone, Trash2, Building2, Receipt, CreditCard,
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

const DEFAULT_PREFERENCES = {
  pushAnnouncements: true,
  pushVisitors: true,
  pushBills: true,
  emailDigest: false,
  showPhoneToNeighbors: false,
  showFlatToVisitors: true,
  marketingEmails: false,
};

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — SociyoHub" }] }),
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
  const isSecurity = hasRole?.("security") ?? false;
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const preferencesKey = user?.id ? `sociohub:prefs:${user.id}` : null;

  // local-only preferences
  const [prefs, setPrefs] = useState(DEFAULT_PREFERENCES);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    try {
      const raw = preferencesKey ? localStorage.getItem(preferencesKey) : null;
      setPrefs(raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES);
    } catch {}
  }, [preferencesKey, profile]);

  useEffect(() => {
    try {
      if (preferencesKey) localStorage.setItem(preferencesKey, JSON.stringify(prefs));
    } catch {}
  }, [preferencesKey, prefs]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(userMessage(error));
    toast.success(t("st.profileUpdated"));
    if (typeof refresh === "function") await refresh();
  }

  const aadhaarVerified = (profile as any)?.aadhaar_verified;
  const aadhaarUploaded = (profile as any)?.aadhaar_uploaded_at;
  const isSocietyAdmin = hasRole?.("society_admin") ?? false;
  const dirty =
    fullName !== (profile?.full_name ?? "") || phone !== (profile?.phone ?? "");
  function discard() {
    setFullName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
  }

  const sections = [
    { value: "profile", label: t("st.tab.profile"), icon: UserIcon },
    ...(!isSecurity ? [{ value: "notifications", label: t("st.tab.alerts"), icon: Bell }] : []),
    ...(!isSecurity ? [{ value: "privacy", label: t("st.tab.privacy"), icon: Lock }] : []),
    { value: "security", label: t("st.tab.security"), icon: ShieldCheck },
    ...(isSocietyAdmin ? [{ value: "society", label: t("st.tab.society"), icon: Building2 }] : []),
    { value: "more", label: t("st.tab.more"), icon: HelpCircle },
  ];

  return (
    <PageShell>
      <PageHeader
        title={t("st.title")}
        description={t("st.desc")}
      />

      {/* Identity */}
      <section aria-label={t("st.yourAccount")} className="mb-6 flex items-center gap-4 rounded-2xl border bg-card p-4">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-primary/15 text-primary text-lg font-semibold">
            {initials(profile?.full_name, user?.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-lg truncate">
              {profile?.full_name || t("st.addName")}
            </p>
            {aadhaarVerified ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1">
                <BadgeCheck className="h-3 w-3" /> {t("st.verified")}
              </Badge>
            ) : aadhaarUploaded ? (
              <Badge variant="secondary">{t("st.verifPending")}</Badge>
            ) : (
              <Badge variant="outline">{t("st.unverified")}</Badge>
            )}
            {isSocietyAdmin && <Badge variant="outline">{t("st.committeeAdmin")}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
        </div>
      </section>

      <Tabs defaultValue="profile" orientation="vertical" className="w-full md:grid md:grid-cols-[200px_1fr] md:gap-6">
        <TabsList
          aria-label={t("st.sections")}
          className="mb-5 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1 md:mb-0 md:flex-col md:items-stretch md:self-start md:bg-transparent md:p-0"
        >
          {sections.map((s) => (
            <TabsTrigger
              key={s.value}
              value={s.value}
              className="h-11 shrink-0 justify-start gap-2 rounded-xl px-3 data-[state=active]:bg-card data-[state=active]:text-primary md:data-[state=active]:bg-primary/10"
            >
              <s.icon className="h-4 w-4" aria-hidden />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0">
        {/* PROFILE */}
        <TabsContent value="profile" className="mt-0">
          <SettingsGroup title={t("st.personal")} scope={t("settings.onlyYou")} icon={UserIcon}>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">{t("st.email")}</Label>
                <Input id="email" value={user?.email ?? ""} disabled className="h-11" />
                <p className="text-xs text-muted-foreground">{t("st.emailFixed")}</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">{t("st.fullName")}</Label>
                <Input id="name" className="h-11" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("st.yourName")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">{t("st.phone")}</Label>
                <Input id="phone" className="h-11" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <p role="status" className="mr-auto text-sm text-muted-foreground">
                  {dirty ? <span className="font-medium text-amber-700 dark:text-amber-400">{t("st.unsaved")}</span> : t("st.allSaved")}
                </p>
                <Button variant="ghost" onClick={discard} disabled={!dirty || saving} className="h-11 rounded-xl">
                  {t("st.discard")}
                </Button>
                <Button onClick={save} disabled={!dirty || saving} className="h-11 rounded-xl">
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  {t("st.saveChanges")}
                </Button>
              </div>
            </div>
          </SettingsGroup>
        </TabsContent>

        {/* NOTIFICATIONS */}
        <TabsContent value="notifications" className="mt-0">
          <SettingsGroup title={t("st.notifPrefs")} scope={t("st.thisDevice")} icon={Bell}
            hint={t("st.deviceHint")}>
            <Row label={t("st.n.ann")} desc={t("st.n.annD")} checked={prefs.pushAnnouncements} onChange={(v) => setPrefs({ ...prefs, pushAnnouncements: v })} />
            <Separator />
            <Row label={t("st.n.vis")} desc={t("st.n.visD")} checked={prefs.pushVisitors} onChange={(v) => setPrefs({ ...prefs, pushVisitors: v })} />
            <Separator />
            <Row label={t("st.n.bills")} desc={t("st.n.billsD")} checked={prefs.pushBills} onChange={(v) => setPrefs({ ...prefs, pushBills: v })} />
            <Separator />
            <Row label={t("st.n.digest")} desc={t("st.n.digestD")} checked={prefs.emailDigest} onChange={(v) => setPrefs({ ...prefs, emailDigest: v })} />
          </SettingsGroup>
        </TabsContent>

        {/* PRIVACY */}
        <TabsContent value="privacy" className="mt-0">
          <SettingsGroup title={t("st.privacy")} scope={t("st.thisDevice")} icon={Lock}
            hint={t("st.deviceHint")}>
            <Row label={t("st.p.phone")} desc={t("st.p.phoneD")} checked={prefs.showPhoneToNeighbors} onChange={(v) => setPrefs({ ...prefs, showPhoneToNeighbors: v })} />
            <Separator />
            <Row label={t("st.p.flat")} desc={t("st.p.flatD")} checked={prefs.showFlatToVisitors} onChange={(v) => setPrefs({ ...prefs, showFlatToVisitors: v })} />
            <Separator />
            <Row label={t("st.p.mkt")} desc={t("st.p.mktD")} checked={prefs.marketingEmails} onChange={(v) => setPrefs({ ...prefs, marketingEmails: v })} />
          </SettingsGroup>
        </TabsContent>

        {/* SECURITY */}
        <TabsContent value="security" className="mt-0 space-y-5">
          {!isSecurity && <SettingsGroup title={t("st.idv")} scope={t("settings.onlyYou")} icon={ShieldCheck}>
            {aadhaarVerified ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
                <BadgeCheck className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-medium">{t("st.idvDone")}</p>
                  <p className="text-sm text-muted-foreground">{t("st.idvDoneD")}</p>
                </div>
              </div>
            ) : aadhaarUploaded ? (
              <div className="rounded-xl border bg-muted/40 p-4">
                <p className="font-medium">{t("st.verifPending")}</p>
                <p className="text-sm text-muted-foreground">{t("st.idvPendD")}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-4">
                <p className="font-medium">{t("st.idvUpload")}</p>
                <p className="text-sm text-muted-foreground mb-3">{t("st.idvUploadD")}</p>
                <Button asChild className="rounded-xl h-11">
                  <Link to="/onboarding/join">{t("st.idvStart")}</Link>
                </Button>
              </div>
            )}
          </SettingsGroup>}

          <SettingsGroup title={t("st.signin")} scope={t("settings.onlyYou")} icon={Lock}>
            <ActionRow
              icon={Lock}
              label={t("st.changePw")}
              desc={t("st.changePwD")}
              onClick={async () => {
                if (!user?.email) return;
                const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login` });
                if (error) return toast.error(userMessage(error));
                toast.success(t("st.pwSent"));
              }}
            />
            <Separator />
            <ActionRow icon={Smartphone} label={t("st.sessions")} desc={t("st.sessionsD")} />
          </SettingsGroup>

          <TwoFactorCard />
        </TabsContent>

        {/* SOCIETY (committee only — each page enforces its own permissions) */}
        {isSocietyAdmin && (
          <TabsContent value="society" className="mt-0">
            <SettingsGroup title={t("st.socAdmin")} scope={t("settings.wholeSociety")} icon={Building2}
              hint={t("st.socAdminHint")}>
              <LinkRow to="/society/business-profile" icon={Building2} label={t("st.socInfo")} desc={t("st.socInfoD")} />
              <Separator />
              <LinkRow to="/society/team" icon={UsersIcon} label={t("st.team")} desc={t("st.teamD")} />
              <Separator />
              <LinkRow to="/society/billing-settings" icon={Receipt} label={t("st.billing")} desc={t("st.billingD")} />
              <Separator />
              <LinkRow to="/society/subscription" icon={CreditCard} label={t("st.sub")} desc={t("st.subD")} />
            </SettingsGroup>
          </TabsContent>
        )}

        {/* MORE */}
        <TabsContent value="more" className="mt-0 space-y-5">
          {!isSecurity && <AppearanceCard
            currentTheme={(profile as any)?.theme ?? "default"}
            societyId={profile?.society_id ?? null}
            userId={user?.id ?? null}
            isSuperAdmin={isSuperAdmin}
            onChanged={() => refresh?.()}
          />}

          <SettingsGroup title={t("settings.householdLanguage")} scope={t("settings.onlyYou")} icon={UsersIcon}>
            {!isSecurity && <><LinkRow to="/app/family" icon={UsersIcon} label={t("settings.family")} />
            <Separator /></>}
            <LanguageRow />
          </SettingsGroup>

          <SettingsGroup title={t("settings.supportLegal")} icon={HelpCircle}>
            <LinkRow to="/support" icon={HelpCircle} label={t("settings.help")} />
            <Separator />
            <LinkRow to="/terms" icon={ShieldCheck} label={t("settings.terms")} />
            <Separator />
            {!isSecurity && <>
              <Separator />
              <LinkRow to="/pricing" icon={ShieldCheck} label={t("settings.pricing")} />
            </>}
          </SettingsGroup>

          <section aria-labelledby="danger-zone" className="rounded-2xl border border-destructive/30 p-2">
            <h2 id="danger-zone" className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-destructive">{t("settings.danger")}</h2>
            <SignOutRow onSignOut={signOut} />
            <Separator />
            <DeleteAccountRow email={user?.email ?? null} onSignOut={signOut} />
          </section>
        </TabsContent>
        </div>
      </Tabs>
    </PageShell>
  );
}

function SettingsGroup({
  title, scope, icon: Icon, hint, children,
}: { title: string; scope?: string; icon: any; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">{title}</h2>
        {scope && (
          <span className="ml-auto rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{scope}</span>
        )}
      </div>
      {hint && <p className="mb-2 text-sm text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

function SignOutRow({ onSignOut }: { onSignOut?: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="w-full min-h-11 flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-muted/50 transition text-left">
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="flex-1 font-medium">{t("common.signOut")}</span>
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("signout.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("signout.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("signout.stay")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onSignOut?.()}>{t("common.signOut")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LanguageRow() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 px-2 py-3">
      <Globe className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("common.language")}</p>
        <p className="text-sm text-muted-foreground">{t("language.onlyYou")}</p>
      </div>
      <LanguageSelector compact />
    </div>
  );
}

function DeleteAccountRow({ email, onSignOut }: { email: string | null; onSignOut: () => Promise<void> }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-destructive/10 transition text-left text-destructive">
          <Trash2 className="h-5 w-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t("settings.deleteAccount")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.deleteAccountDesc")}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("st.delTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("st.delBody")} <strong>DELETE</strong>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("st.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm !== "DELETE" || busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              // Soft-delete: clear profile fields. Auth user removal needs admin/support.
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await (supabase as any).rpc("reset_own_kyc");
                await supabase.from("profiles").update({
                  full_name: "Deleted user", phone: null, avatar_url: null,
                } as any).eq("id", user.id);
                await supabase.from("family_members").delete().eq("user_id", user.id);
              }
              toast.success(t("st.delRequested", { email: email ?? t("st.you") }));
              await onSignOut();
            }}
          >{t("st.permDelete")}</AlertDialogAction>
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
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
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
  to, icon: Icon, label, desc,
}: { to: string; icon: any; label: string; desc?: string }) {
  return (
    <Link
      to={to as any}
      className="w-full min-h-11 flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-muted/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-medium">{label}</span>
        {desc && <span className="block text-sm text-muted-foreground">{desc}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
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
    supabase.from("societies").select("plan, plan_id").eq("id", societyId).maybeSingle()
      .then(({ data }) => {
        const d = data as any;
        // Prefer the modern plan_id (references plans.id: trial/basic/pro/premium),
        // fall back to the legacy plan text column.
        setPlan((d?.plan_id ?? d?.plan) ?? null);
      });
  }, [societyId]);

  // Neon theme is included on every paid, ad-free tier (Pro, Premium, custom).
  const isPremium = isSuperAdmin || plan === "premium" || plan === "pro" || plan === "master";

  async function setTheme(next: "default" | "neon") {
    if (next === "neon" && !isPremium) {
      toast.error(t("st.neonPlan"));
      return;
    }
    if (!userId) return;
    setSaving(true);
    const { error } = await (supabase as any).from("profiles").update({ theme: next }).eq("id", userId);
    setSaving(false);
    if (error) return toast.error(userMessage(error));
    toast.success(next === "neon" ? t("st.neonOn") : t("st.stdOn"));
    onChanged();
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserIcon className="h-5 w-5 text-primary" /> {t("st.appearance")}
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
            <p className="font-semibold">{t("st.standard")}</p>
            <p className="text-xs text-muted-foreground">{t("st.standardD")}</p>
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
              {!isPremium && <Badge variant="outline" className="text-[10px] ml-1">Growth+</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">{t("st.neonD")}</p>
          </button>
        </div>
        {!isPremium && (
          <p className="text-xs text-muted-foreground">
            {t("st.upgradeNeon")} <Link to="/pricing" className="underline">Growth / Pro</Link>
          </p>
        )}
        {isSuperAdmin && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {t("st.superAll")}
          </p>
        )}

        <Separator />
        <A11yToggle />

        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("st.neonPreview")}</summary>
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
    toast.success(v ? t("st.a11yOn") : t("st.a11yOff"));
  }
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{t("st.a11y")}</p>
          <p className="text-sm text-muted-foreground">{t("st.a11yD")}</p>
        </div>
        <Switch checked={on} onCheckedChange={toggle} aria-label={t("st.a11yToggle")} />
      </div>
    </div>
  );
}
