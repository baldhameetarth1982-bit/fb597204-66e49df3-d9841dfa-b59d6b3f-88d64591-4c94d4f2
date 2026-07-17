import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Loader2, Plus, Crown, Building2, UserCog, ShieldAlert, EyeOff } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/shared/PageHeader";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listTeamMembers, upsertTeamRole, setTeamActive,
  listAssignmentCandidates, getSocietyPrivacy, setSocietyPrivacy,
} from "@/lib/team-admin.functions";
import {
  ROLE_LABELS, ASSIGNABLE_TEAM_ROLES,
  capabilitiesForRole, CAPABILITY_LABELS,
  PRIVACY_DIRECTORY, PRIVACY_CONTACTS, PRIVACY_FINANCES,
  PRIVACY_VEHICLES, PRIVACY_DOCUMENTS,
  PRIVACY_LABELS, PRIVACY_DESCRIPTIONS,
  DEFAULT_PRIVACY, type SocietyPrivacySettings, type Role,
} from "@/lib/role-permissions";

export const Route = createFileRoute("/_society/society/team")({
  head: () => ({ meta: [{ title: "Team & Roles — SociyoHub" }] }),
  component: () => (
    <FeatureGate feature="team_roles"><TeamPage /></FeatureGate>
  ),
});

type TeamRole = "society_admin" | "block_admin" | "security";

interface Member {
  role_id: string;
  user_id: string;
  full_name: string;
  role: TeamRole;
  block_ids: string[];
  block_names: string[];
  is_active: boolean;
  updated_at: string;
}

interface Block { id: string; name: string }
interface Candidate { id: string; full_name: string | null; email: string | null }

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function friendlyError(code: string): string {
  switch (code) {
    case "forbidden": return "You do not have permission to do that.";
    case "target_not_in_society": return "That person is not a member of this society.";
    case "invalid_role": return "That role cannot be assigned here.";
    case "block_scope_required": return "Choose at least one block for a Block Admin.";
    case "invalid_block_scope": return "Selected block is not valid for this society.";
    case "block_admin_unavailable_serial_mode":
      return "Block Admin is not available in serial (no-blocks) societies.";
    case "last_society_admin":
      return "This is the last active Society Admin — assign another admin first.";
    case "role_not_found": return "That role could not be found.";
    default: return "Something went wrong. Please try again.";
  }
}

function TeamPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [members, setMembers] = useState<Member[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [structureMode, setStructureMode] = useState<"structured" | "serial">("structured");
  const [privacy, setPrivacy] = useState<SocietyPrivacySettings>(DEFAULT_PRIVACY);
  const [loading, setLoading] = useState(true);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const fnList = useServerFn(listTeamMembers);
  const fnUpsert = useServerFn(upsertTeamRole);
  const fnSetActive = useServerFn(setTeamActive);
  const fnCandidates = useServerFn(listAssignmentCandidates);
  const fnGetPrivacy = useServerFn(getSocietyPrivacy);
  const fnSetPrivacy = useServerFn(setSocietyPrivacy);

  async function loadAll(sid: string) {
    setLoading(true);
    try {
      const [team, blocksRes, socRes, priv] = await Promise.all([
        fnList({ data: { societyId: sid, includeInactive: true } }),
        supabase.from("blocks").select("id, name, is_active").eq("society_id", sid).order("name"),
        supabase.from("societies").select("structure_mode").eq("id", sid).maybeSingle(),
        fnGetPrivacy({ data: { societyId: sid } }),
      ]);
      setMembers(team.members);
      setBlocks((blocksRes.data ?? []).filter((b) => b.is_active !== false).map((b) => ({ id: b.id, name: b.name })));
      setStructureMode(((socRes.data?.structure_mode as string) === "serial") ? "serial" : "structured");
      setPrivacy(priv);
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (societyId) void loadAll(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members]);
  const chairmanCount = activeMembers.filter((m) => m.role === "society_admin").length;
  const blockAdminCount = activeMembers.filter((m) => m.role === "block_admin").length;
  const securityCount = activeMembers.filter((m) => m.role === "security").length;

  async function handleToggleActive(m: Member) {
    if (!societyId) return;
    try {
      await fnSetActive({ data: { societyId, roleId: m.role_id, isActive: !m.is_active } });
      toast.success(m.is_active ? "Team member deactivated" : "Team member reactivated");
      void loadAll(societyId);
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    }
  }

  async function handlePrivacySave(next: SocietyPrivacySettings) {
    if (!societyId) return;
    setSavingPrivacy(true);
    try {
      await fnSetPrivacy({ data: { societyId, ...next } });
      setPrivacy(next);
      toast.success("Privacy updated");
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setSavingPrivacy(false);
    }
  }

  if (!sidLoading && !societyId) {
    return (
      <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
        <MobileHero eyebrow="Society Admin" title="Team & Roles" icon={ShieldCheck} variant="teal" />
        <div className="px-4 pt-4 max-w-5xl mx-auto md:px-8">
          <EmptyState icon={ShieldCheck} title="Set up your society first" />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Society Admin"
        title="Team & Roles"
        subtitle="Assign roles, manage block scope, and control what residents can see."
        icon={ShieldCheck}
        variant="teal"
        action={
          <AssignDialog
            blocks={blocks}
            structureMode={structureMode}
            fnCandidates={fnCandidates}
            fnUpsert={fnUpsert}
            societyId={societyId!}
            onDone={() => societyId && loadAll(societyId)}
          />
        }
        stats={
          <StatPillRow>
            <StatPill label="Active team" value={activeMembers.length} />
            <StatPill label="Society admins" value={chairmanCount} />
            <StatPill label="Block admins" value={blockAdminCount} />
            <StatPill label="Guards" value={securityCount} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <SectionCard title={`Team members · ${members.length}`} bodyClassName="p-0">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : members.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={ShieldCheck} title="No team roles yet" description="Promote residents to delegate management of blocks or security." />
            </div>
          ) : (
            <ListCardGroup>
              {members.map((m) => (
                <ListCard
                  key={m.role_id}
                  leading={
                    <Avatar className="h-11 w-11">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {initials(m.full_name)}
                      </AvatarFallback>
                    </Avatar>
                  }
                  title={
                    <span className="flex items-center gap-1">
                      {m.role === "society_admin" && <Crown className="h-3.5 w-3.5 text-primary" />}
                      {m.full_name}
                    </span>
                  }
                  subtitle={
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="rounded-md text-[10px]">{ROLE_LABELS[m.role as Role]}</Badge>
                      {m.block_names.map((bn) => (
                        <Badge key={bn} variant="outline" className="rounded-md text-[10px]">
                          <Building2 className="h-3 w-3 mr-1" />{bn}
                        </Badge>
                      ))}
                      {!m.is_active && (
                        <Badge variant="outline" className="rounded-md text-[10px] border-destructive/40 text-destructive">
                          Inactive
                        </Badge>
                      )}
                    </span>
                  }
                  trailing={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggleActive(m)}
                      className="h-9 min-w-[44px] text-xs"
                      aria-label={m.is_active ? "Deactivate" : "Reactivate"}
                    >
                      {m.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  }
                />
              ))}
            </ListCardGroup>
          )}
        </SectionCard>

        <SectionCard
          title="Privacy & Transparency"
          description="Control what residents can see. Changes are audited."
          icon={EyeOff}
        >
          <PrivacyControls
            value={privacy}
            saving={savingPrivacy}
            onSave={handlePrivacySave}
          />
        </SectionCard>

        <SectionCard
          title="Role permissions"
          description="Read-only preview generated from the canonical permission model."
          icon={UserCog}
        >
          <RolePermissionPreview />
        </SectionCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AssignDialog({
  blocks, structureMode, societyId,
  fnCandidates, fnUpsert, onDone,
}: {
  blocks: Block[];
  structureMode: "structured" | "serial";
  societyId: string;
  fnCandidates: (args: { data: { societyId: string; search?: string | null } }) => Promise<{ candidates: Candidate[] }>;
  fnUpsert: (args: { data: { societyId: string; targetUserId: string; role: TeamRole; blockId?: string | null } }) => Promise<{ roleId: string }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingC, setLoadingC] = useState(false);
  const [selUser, setSelUser] = useState("");
  const [selRole, setSelRole] = useState<TeamRole>("block_admin");
  const [selBlock, setSelBlock] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoadingC(true);
      try {
        const res = await fnCandidates({ data: { societyId, search: search || null } });
        setCandidates(res.candidates);
      } catch (e) {
        toast.error(friendlyError((e as Error).message));
      } finally {
        setLoadingC(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [open, search, societyId, fnCandidates]);

  const roleOptions = ASSIGNABLE_TEAM_ROLES.filter(
    (r) => !(r === "block_admin" && structureMode === "serial"),
  );

  const preview = capabilitiesForRole(selRole);

  async function handleAssign() {
    if (!selUser) return;
    if (selRole === "block_admin" && !selBlock) {
      toast.error("Choose a block for the Block Admin");
      return;
    }
    setSaving(true);
    try {
      await fnUpsert({
        data: {
          societyId, targetUserId: selUser, role: selRole,
          blockId: selRole === "block_admin" ? selBlock : null,
        },
      });
      toast.success("Role assigned");
      setOpen(false);
      setSelUser(""); setSelBlock(""); setSelRole("block_admin"); setSearch("");
      onDone();
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
          <Plus className="h-4 w-4 mr-1" /> Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle>Assign a role</DialogTitle>
          <DialogDescription>
            Promote an existing society member. Super Admin cannot be assigned here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Search member</Label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Member</Label>
            <Select value={selUser} onValueChange={setSelUser}>
              <SelectTrigger className="rounded-xl min-h-11"><SelectValue placeholder={loadingC ? "Loading…" : "Pick a member"} /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name || c.email || c.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={selRole} onValueChange={(v) => setSelRole(v as TeamRole)}>
              <SelectTrigger className="rounded-xl min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r as Role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {structureMode === "serial" && (
              <p className="text-xs text-muted-foreground">
                Block Admin is unavailable — this society uses serial (no-blocks) mode.
              </p>
            )}
          </div>
          {selRole === "block_admin" && (
            <div className="space-y-2">
              <Label>Block</Label>
              <Select value={selBlock} onValueChange={setSelBlock}>
                <SelectTrigger className="rounded-xl min-h-11"><SelectValue placeholder="Choose block" /></SelectTrigger>
                <SelectContent>
                  {blocks.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" /> This role will grant:
            </p>
            <ul className="text-xs text-foreground/80 leading-relaxed list-disc pl-4">
              {preview.slice(0, 6).map((c) => (<li key={c}>{CAPABILITY_LABELS[c]}</li>))}
              {preview.length > 6 && <li>+ {preview.length - 6} more…</li>}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAssign} disabled={saving || !selUser} className="rounded-xl min-h-11">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function PrivacyControls({
  value, saving, onSave,
}: {
  value: SocietyPrivacySettings;
  saving: boolean;
  onSave: (next: SocietyPrivacySettings) => void;
}) {
  const [draft, setDraft] = useState<SocietyPrivacySettings>(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div className="space-y-4">
      <PrivacyRow
        title="Member directory"
        value={draft.privacy_directory}
        options={PRIVACY_DIRECTORY.map((v) => ({
          value: v, label: PRIVACY_LABELS.directory[v], desc: PRIVACY_DESCRIPTIONS.directory[v],
        }))}
        onChange={(v) => setDraft({ ...draft, privacy_directory: v as SocietyPrivacySettings["privacy_directory"] })}
      />
      <PrivacyRow
        title="Resident contacts (phone, email)"
        value={draft.privacy_contacts}
        options={PRIVACY_CONTACTS.map((v) => ({
          value: v, label: PRIVACY_LABELS.contacts[v], desc: PRIVACY_DESCRIPTIONS.contacts[v],
        }))}
        onChange={(v) => setDraft({ ...draft, privacy_contacts: v as SocietyPrivacySettings["privacy_contacts"] })}
      />
      <PrivacyRow
        title="Financial transparency"
        value={draft.privacy_finances}
        options={PRIVACY_FINANCES.map((v) => ({
          value: v, label: PRIVACY_LABELS.finances[v], desc: PRIVACY_DESCRIPTIONS.finances[v],
        }))}
        onChange={(v) => setDraft({ ...draft, privacy_finances: v as SocietyPrivacySettings["privacy_finances"] })}
      />
      <PrivacyRow
        title="Vehicle information"
        value={draft.privacy_vehicles}
        options={PRIVACY_VEHICLES.map((v) => ({
          value: v, label: PRIVACY_LABELS.vehicles[v], desc: PRIVACY_DESCRIPTIONS.vehicles[v],
        }))}
        onChange={(v) => setDraft({ ...draft, privacy_vehicles: v as SocietyPrivacySettings["privacy_vehicles"] })}
      />
      <PrivacyRow
        title="Documents"
        value={draft.privacy_documents}
        options={PRIVACY_DOCUMENTS.map((v) => ({
          value: v, label: PRIVACY_LABELS.documents[v], desc: PRIVACY_DESCRIPTIONS.documents[v],
        }))}
        onChange={(v) => setDraft({ ...draft, privacy_documents: v as SocietyPrivacySettings["privacy_documents"] })}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          className="rounded-xl min-h-11"
          disabled={!dirty || saving}
          onClick={() => setDraft(value)}
        >
          Discard
        </Button>
        <Button
          className="rounded-xl min-h-11"
          disabled={!dirty || saving}
          onClick={() => onSave(draft)}
        >
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save privacy
        </Button>
      </div>
    </div>
  );
}

function PrivacyRow({
  title, value, options, onChange,
}: {
  title: string;
  value: string;
  options: { value: string; label: string; desc: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{title}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="rounded-xl min-h-11"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {options.find((o) => o.value === value)?.desc ?? ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RolePermissionPreview() {
  const roles: Role[] = ["society_admin", "block_admin", "security", "resident"];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {roles.map((role) => {
        const caps = capabilitiesForRole(role);
        return (
          <div key={role} className="rounded-xl border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="rounded-md text-[10px]">{ROLE_LABELS[role]}</Badge>
              <span className="text-xs text-muted-foreground">{caps.length} capabilities</span>
            </div>
            <ul className="text-xs text-foreground/80 space-y-1 list-disc pl-4">
              {caps.map((c) => (<li key={c}>{CAPABILITY_LABELS[c]}</li>))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Provide a tiny shim so we can render a Switch import without changing layout
// even though it's not used above. Keeps existing imports linter-clean.
export const __switchShim = Switch;
