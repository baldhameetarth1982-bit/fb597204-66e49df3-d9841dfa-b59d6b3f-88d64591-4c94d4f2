import { useState } from "react";
import { askText } from "@/components/system/AskTextDialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, History, UserPlus } from "lucide-react";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loading, ErrorRow, errText } from "@/components/roles/RoleShell";
import {
  STAFF_PERMISSIONS, STAFF_PERMISSION_LABELS, cancelRoleInvite, inviteRole, listRoleAccess, setRoleAccess, setStaffPermissions,
  type RoleAccess, type StaffPermission,
} from "@/lib/role-access.functions";
import { tu } from "@/lib/i18n";

const mutOpts = { networkMode: "always" as const, retry: false };
const ACTION_LABEL: Record<string, string> = {
  "roles.invited": "Invitation sent", "roles.invite_cancelled": "Invitation cancelled", "roles.invite_declined": "Invitation declined",
  "roles.invite_accepted": "Invitation accepted", "roles.revoked": "Access removed", "roles.reactivated": "Access restored",
  "roles.permissions_changed": "Permissions changed",
};
const ask = async (msg: string) => { const r = (await askText(msg, { minLength: 5 }))?.trim(); return r && r.length >= 5 ? r : null; };

function PermissionPicker({ value, onChange, idPrefix }: { value: StaffPermission[]; onChange: (v: StaffPermission[]) => void; idPrefix: string }) {
  return (
    <fieldset className="grid gap-1 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">{tu("op.work_areas")}</legend>
      {STAFF_PERMISSIONS.map((p) => (
        <label key={p} htmlFor={`${idPrefix}-${p}`} className="flex min-h-11 items-center gap-2 text-sm">
          <input id={`${idPrefix}-${p}`} type="checkbox" className="h-4 w-4" checked={value.includes(p)}
            onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
          {STAFF_PERMISSION_LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

/** Committee view: invite, revoke and scope Auditor and Staff logins. All checks happen on the server. */
export function RoleAccessPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listRoleAccess);
  const q = useQuery({ queryKey: ["role-access"], queryFn: () => listFn(), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["role-access"] });
  return (
    <div className="mx-auto mt-6 max-w-5xl space-y-4 px-4 pb-10 sm:px-6">
      <SectionCard title={tu("op.auditor_staff_logins")} description={tu("op.an_auditor_sees_the_accounts")} icon={BadgeCheck}>
        {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : <AccessBody data={q.data} onChange={refresh} />}
      </SectionCard>
    </div>
  );
}

function AccessBody({ data, onChange }: { data: RoleAccess; onChange: () => void }) {
  const inviteFn = useServerFn(inviteRole);
  const cancelFn = useServerFn(cancelRoleInvite);
  const accessFn = useServerFn(setRoleAccess);
  const permFn = useServerFn(setStaffPermissions);
  const [role, setRole] = useState<"auditor" | "staff">("auditor");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [staffId, setStaffId] = useState("");
  const [perms, setPerms] = useState<StaffPermission[]>(["staff.helpdesk"]);
  const [editing, setEditing] = useState<{ roleId: string; perms: StaffPermission[] } | null>(null);
  const done = (msg: string) => { toast.success(msg); onChange(); };
  const fail = (e: unknown) => toast.error(errText(e));

  const invite = useMutation({ ...mutOpts,
    mutationFn: () => inviteFn({ data: { role, phone, name: role === "auditor" ? name : undefined, staffId: role === "staff" ? staffId : undefined, permissions: role === "staff" ? perms : [] } }),
    onSuccess: () => { setPhone(""); setName(""); setStaffId(""); done("Invitation sent. They'll see it after signing in with that phone number."); }, onError: fail });
  const cancel = useMutation({ ...mutOpts, mutationFn: (v: { id: string; reason: string }) => cancelFn({ data: v }), onSuccess: () => done("Invitation cancelled"), onError: fail });
  const access = useMutation({ ...mutOpts, mutationFn: (v: { roleId: string; active: boolean; reason?: string }) => accessFn({ data: v }),
    onSuccess: (_r, v) => done(v.active ? "Access restored" : "Access removed — it stops working immediately"), onError: fail });
  const savePerms = useMutation({ ...mutOpts, mutationFn: (v: { roleId: string; permissions: StaffPermission[] }) => permFn({ data: v }),
    onSuccess: () => { setEditing(null); done("Permissions saved"); }, onError: fail });

  const phoneOk = /^(\+?91[\s-]?)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ""));
  const canInvite = phoneOk && (role === "auditor" || !!staffId) && !invite.isPending;
  const pending = data.invitations.filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <form className="space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); if (canInvite) invite.mutate(); }}>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" />{tu("vs.invite")}</h3>
        <div className="flex gap-2">
          {(["auditor", "staff"] as const).map((r) => (
            <Button key={r} type="button" size="sm" className="min-h-11" variant={role === r ? "default" : "outline"} onClick={() => setRole(r)}>{r === "auditor" ? tu("op.auditor") : tu("op.staff_member")}</Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="ri-phone">{tu("otp.mobile")}</Label><Input id="ri-phone" inputMode="tel" autoComplete="off" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!phone && !phoneOk} />
            {phone && !phoneOk && <p className="mt-1 text-xs text-destructive">{tu("op.enter_a_10_digit_indian")}</p>}</div>
          {role === "auditor" ? (
            <div><Label htmlFor="ri-name">{tu("op.name_optional")}</Label><Input id="ri-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          ) : (
            <div><Label htmlFor="ri-staff">{tu("op.staff_record")}</Label>
              <select id="ri-staff" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">{data.staff_options.length ? tu("op.choose_staff_member") : tu("op.add_staff_under_operations_first")}</option>
                {data.staff_options.map((s) => <option key={s.id} value={s.id}>{s.full_name} · {s.job_type.replace(/_/g, " ")}</option>)}
              </select></div>
          )}
        </div>
        {role === "staff" && <PermissionPicker idPrefix="ri" value={perms} onChange={setPerms} />}
        {role === "staff" && perms.includes("finance.read") && <p className="text-xs text-muted-foreground">{tu("op.finance_read_only_lets_this")}</p>}
        <Button type="submit" className="min-h-11" disabled={!canInvite}>{tu("op.send_invitation")}</Button>
        <p className="text-xs text-muted-foreground">{tu("op.they_must_sign_in_with")}</p>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{tu("op.people_with_access")}</h3>
        {data.members.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_auditor_or_staff_logins")}</p> : (
          <ul className="divide-y rounded-lg border">
            {data.members.map((m) => (
              <li key={m.role_id} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{m.full_name} <Badge variant="outline" className="ml-1">{m.role === "auditor" ? tu("op.auditor") : `Staff${m.job_type ? ` · ${m.job_type.replace(/_/g, " ")}` : ""}`}</Badge></p>
                    <p className="text-muted-foreground">
                      {m.is_active ? (m.last_seen_at ? `Last active ${new Date(m.last_seen_at).toLocaleString("en-IN")}` : tu("op.not_signed_in_yet")) : `Removed${m.revoked_reason ? `: ${m.revoked_reason}` : ""}`}
                    </p>
                    {m.role === "staff" && m.is_active && <p className="text-muted-foreground">{m.permissions.length ? m.permissions.map((p) => STAFF_PERMISSION_LABELS[p as StaffPermission] ?? p).join(", ") : tu("op.no_work_areas")}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {m.role === "staff" && m.is_active && <Button size="sm" variant="outline" className="min-h-11" onClick={() => setEditing({ roleId: m.role_id, perms: m.permissions.filter((p): p is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(p)) })}>{tu("op.permissions")}</Button>}
                    {m.is_active
                      ? <Button size="sm" variant="destructive" className="min-h-11" disabled={access.isPending} onClick={async () => { const r = await ask("Why are you removing this access?"); if (r) access.mutate({ roleId: m.role_id, active: false, reason: r }); }}>{tu("op.remove_access")}</Button>
                      : <Button size="sm" variant="outline" className="min-h-11" disabled={access.isPending} onClick={() => access.mutate({ roleId: m.role_id, active: true })}>{tu("op.restore")}</Button>}
                  </div>
                </div>
                {editing?.roleId === m.role_id && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <PermissionPicker idPrefix={`e-${m.role_id}`} value={editing.perms} onChange={(v) => setEditing({ ...editing, perms: v })} />
                    <div className="flex gap-2">
                      <Button size="sm" className="min-h-11" disabled={savePerms.isPending} onClick={() => savePerms.mutate({ roleId: m.role_id, permissions: editing.perms })}>{tu("common.save")}</Button>
                      <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setEditing(null)}>{tu("common.cancel")}</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{tu("op.invitations")}</h3>
        {data.invitations.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_invitations_sent_yet")}</p> : (
          <ul className="divide-y rounded-lg border">
            {data.invitations.slice(0, 15).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div><p className="font-medium">{i.display_name ?? (i.role === "auditor" ? tu("op.auditor") : tu("gd.catStaff"))} · ••••{i.phone_last4}</p>
                  <p className="text-muted-foreground">{i.status === "pending" ? `Waiting · expires ${new Date(i.expires_at).toLocaleDateString("en-IN")}` : i.status[0]!.toUpperCase() + i.status.slice(1)}</p></div>
                {i.status === "pending" && <Button size="sm" variant="outline" className="min-h-11" disabled={cancel.isPending} onClick={async () => { const r = await ask("Reason for cancelling this invitation"); if (r) cancel.mutate({ id: i.id, reason: r }); }}>{tu("common.cancel")}</Button>}
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{pending.length} {tu("op.waiting_for_a_reply")}</p>}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />{tu("billingTabs.history")}</h3>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.nothing_yet")}</p> : (
          <ul className="space-y-1 text-sm">
            {data.history.slice(0, 20).map((h, idx) => (
              <li key={`${h.at}-${idx}`} className="flex flex-wrap justify-between gap-2"><span>{ACTION_LABEL[h.action] ?? h.action}{typeof h.metadata?.["reason"] === "string" ? ` — ${h.metadata["reason"]}` : ""}</span><span className="text-muted-foreground">{new Date(h.at).toLocaleString("en-IN")}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
