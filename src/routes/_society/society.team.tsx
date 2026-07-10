import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, Plus, Trash2, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState } from "@/components/shared/PageHeader";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/team")({
  head: () => ({ meta: [{ title: "Team & Roles — SocioHub" }] }),
  component: () => (<FeatureGate feature="team_roles"><TeamPage /></FeatureGate>),
});

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}
interface Block { id: string; name: string }
interface RoleRow {
  id: string;
  user_id: string;
  role: "society_admin" | "block_admin" | "security" | "resident" | "super_admin";
  block_id: string | null;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  society_admin: "Chairman",
  block_admin: "Block Admin",
  security: "Security/Guard",
  resident: "Resident",
};

function TeamPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selUser, setSelUser] = useState("");
  const [selRole, setSelRole] = useState<"block_admin" | "security">("block_admin");
  const [selBlock, setSelBlock] = useState<string>("");

  async function load(sid: string) {
    setLoading(true);
    const [{ data: p }, { data: b }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").eq("society_id", sid),
      supabase.from("blocks").select("id, name").eq("society_id", sid).order("name"),
      supabase.from("user_roles").select("id, user_id, role, block_id").eq("society_id", sid),
    ]);
    setProfiles((p ?? []) as Profile[]);
    setBlocks((b ?? []) as Block[]);
    setRoles((r ?? []) as RoleRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (societyId) void load(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]);

  async function handleAssign() {
    if (!societyId || !selUser) return;
    if (selRole === "block_admin" && !selBlock) {
      toast.error("Choose a block for the Block Admin");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("user_roles").insert({
      user_id: selUser,
      role: selRole,
      society_id: societyId,
      block_id: selRole === "block_admin" ? selBlock : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Role assigned");
    setOpen(false);
    setSelUser(""); setSelBlock(""); setSelRole("block_admin");
    void load(societyId);
  }

  async function handleRevoke(roleId: string) {
    if (!societyId) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
    if (error) { toast.error(error.message); return; }
    toast.success("Role revoked");
    void load(societyId);
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

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const adminRoles = roles.filter((r) =>
    r.role === "society_admin" || r.role === "block_admin" || r.role === "security",
  );

  const chairmanCount = adminRoles.filter((r) => r.role === "society_admin").length;
  const blockAdminCount = adminRoles.filter((r) => r.role === "block_admin").length;
  const securityCount = adminRoles.filter((r) => r.role === "security").length;

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Society Admin"
        title="Team & Roles"
        subtitle="Promote residents to Block Admin or Security. Chairman sees everything."
        icon={ShieldCheck}
        variant="teal"
        stats={
          <StatPillRow>
            <StatPill label="Chairman" value={chairmanCount} />
            <StatPill label="Block admins" value={blockAdminCount} />
            <StatPill label="Guards" value={securityCount} />
            <StatPill label="Residents" value={profiles.length} />
          </StatPillRow>
        }
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
                <Plus className="h-4 w-4 mr-1" /> Assign
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl">
                <Plus className="h-4 w-4 mr-2" /> Assign Role
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle>Promote a resident</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Resident</Label>
                  <Select value={selUser} onValueChange={setSelUser}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Pick a resident" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name || p.email || p.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={selRole} onValueChange={(v) => setSelRole(v as any)}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block_admin">Block Admin</SelectItem>
                      <SelectItem value="security">Security / Guard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {selRole === "block_admin" && (
                  <div className="space-y-2">
                    <Label>Block</Label>
                    <Select value={selBlock} onValueChange={setSelBlock}>
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Choose block" />
                      </SelectTrigger>
                      <SelectContent>
                        {blocks.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleAssign} disabled={saving} className="rounded-xl">
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Assign
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : adminRoles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No team roles yet"
          description="Promote residents to delegate management of blocks or security."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {adminRoles.map((r) => {
            const p = profileMap.get(r.user_id);
            const block = blocks.find((b) => b.id === r.block_id);
            const isChairman = r.role === "society_admin";
            return (
              <Card key={r.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                      {initials(p?.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-1">
                      {isChairman && <Crown className="h-3.5 w-3.5 text-primary" />}
                      {p?.full_name ?? p?.email ?? "Unknown"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="rounded-md text-xs">
                        {ROLE_LABEL[r.role]}
                      </Badge>
                      {block && (
                        <Badge variant="outline" className="rounded-md text-xs">
                          {block.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!isChairman && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRevoke(r.id)}
                      className="rounded-lg text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
