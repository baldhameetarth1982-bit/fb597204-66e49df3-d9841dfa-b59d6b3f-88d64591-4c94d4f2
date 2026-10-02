import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Auditor + Staff access. Every call goes through a SECURITY DEFINER RPC that
 * derives the society, role and permissions from the caller's live session —
 * nothing here accepts a society, role, staff or auditor id from the client.
 */

const uuid = z.string().uuid();
type Ctx = { supabase: unknown };
type RpcClient = { rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export const STAFF_PERMISSIONS = [
  "staff.helpdesk", "staff.assets", "staff.inventory", "staff.vendors", "staff.documents", "finance.read",
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  "staff.helpdesk": "Assigned helpdesk work",
  "staff.assets": "Assets & service log",
  "staff.inventory": "Inventory (use stock)",
  "staff.vendors": "Vendor contacts",
  "staff.documents": "Resident-facing documents",
  "finance.read": "Finance (read-only)",
};

const MESSAGES: Array<[string, string]> = [
  ["self_assignment", "You can't give access to yourself."],
  ["invalid_phone", "Enter a valid 10-digit Indian mobile number."],
  ["invite_exists", "There is already a pending invitation for this number."],
  ["staff_not_found", "Choose an active staff member."],
  ["staff_already_linked", "This staff member already has an active login."],
  ["invalid_permissions", "One of the selected permissions isn't allowed."],
  ["invite_unavailable", "This invitation is no longer available. Ask the committee for a new one."],
  ["reason_required", "Enter a reason (at least 5 characters)."],
  ["role_not_found", "That access record was not found."],
  ["invalid_transition", "This request can't move to that status."],
  ["insufficient_stock", "Not enough stock for that quantity."],
  ["invalid_quantity", "Enter a valid quantity."],
  ["invalid_note", "Add a note (up to 2,000 characters)."],
  ["invalid_period", "Choose a valid date range."],
  ["plan_required", "This feature needs an active Growth or Pro plan."],
  ["rate_limited", "Too many requests. Please wait a moment."],
  ["not_authorized", "You don't have access to this. It may have been removed."],
  ["permission denied", "You don't have access to this. It may have been removed."],
  ["not_found", "Not found."],
];

async function rpc(context: Ctx, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (context.supabase as RpcClient).rpc(name, args);
  if (error) {
    const m = error.message.toLowerCase();
    const hit = MESSAGES.find(([k]) => m.includes(k));
    throw new Error(hit ? hit[1] : "The request could not be completed.");
  }
  return data;
}

const auth = () => createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]);

/* ---------------- Committee: invite / revoke / permissions ---------------- */

const MemberSchema = z.object({
  role_id: uuid, role: z.enum(["auditor", "staff"]), is_active: z.boolean(), permissions: z.array(z.string()),
  full_name: z.string(), job_type: z.string().nullable(), staff_id: uuid.nullable(), revoked_reason: z.string().nullable(),
  deactivated_at: z.string().nullable(), created_at: z.string(), last_seen_at: z.string().nullable(), device: z.string().nullable(),
});
const InviteSchema = z.object({
  id: uuid, role: z.enum(["auditor", "staff"]), display_name: z.string().nullable(), phone_last4: z.string(),
  status: z.enum(["pending", "accepted", "cancelled", "declined", "expired"]), expires_at: z.string(),
  permissions: z.array(z.string()), created_at: z.string(), cancelled_reason: z.string().nullable(),
});
const AccessSchema = z.object({
  members: z.array(MemberSchema),
  invitations: z.array(InviteSchema),
  history: z.array(z.object({ action: z.string(), at: z.string(), metadata: z.record(z.string(), z.unknown()).nullable() })),
  staff_options: z.array(z.object({ id: uuid, full_name: z.string(), job_type: z.string() })),
});
export type RoleAccess = z.infer<typeof AccessSchema>;

export const listRoleAccess = auth().handler(async ({ context }) => AccessSchema.parse(await rpc(context, "admin_list_role_access")));

export const inviteRole = auth().inputValidator(z.object({
  role: z.enum(["auditor", "staff"]), phone: z.string().trim().min(10).max(16),
  name: z.string().trim().max(80).optional(), staffId: uuid.optional(),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(6).default([]),
})).handler(async ({ data, context }) => {
  await rpc(context, "admin_invite_role", { _role: data.role, _phone: data.phone, _name: data.name || null, _staff: data.staffId ?? null, _permissions: data.permissions });
  return { ok: true };
});

export const cancelRoleInvite = auth().inputValidator(z.object({ id: uuid, reason: z.string().trim().min(5).max(300) }))
  .handler(async ({ data, context }) => { await rpc(context, "admin_cancel_role_invitation", { _id: data.id, _reason: data.reason }); return { ok: true }; });

export const setRoleAccess = auth().inputValidator(z.object({ roleId: uuid, active: z.boolean(), reason: z.string().trim().max(300).optional() }))
  .handler(async ({ data, context }) => { await rpc(context, "admin_set_role_access", { _role_id: data.roleId, _active: data.active, _reason: data.reason ?? null }); return { ok: true }; });

export const setStaffPermissions = auth().inputValidator(z.object({ roleId: uuid, permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(6) }))
  .handler(async ({ data, context }) => { await rpc(context, "admin_set_staff_permissions", { _role_id: data.roleId, _permissions: data.permissions }); return { ok: true }; });

/* ---------------- Invitee ---------------- */

const MyInviteSchema = z.array(z.object({ id: uuid, society_name: z.string(), role: z.enum(["auditor", "staff"]), job_type: z.string().nullable(), permissions: z.array(z.string()), expires_at: z.string() }));
export type MyInvite = z.infer<typeof MyInviteSchema>[number];
export const listMyInvites = auth().handler(async ({ context }) => MyInviteSchema.parse((await rpc(context, "list_my_role_invitations")) ?? []));
export const respondInvite = auth().inputValidator(z.object({ id: uuid, accept: z.boolean() }))
  .handler(async ({ data, context }) => { await rpc(context, "respond_role_invitation", { _id: data.id, _accept: data.accept }); return { ok: true }; });

/* ---------------- Live role check (heartbeat) ---------------- */

const MyAccessSchema = z.object({
  society_id: uuid.nullable(), society_name: z.string().nullable(),
  roles: z.array(z.object({ role: z.enum(["auditor", "staff"]), permissions: z.array(z.string()) })),
});
export type MyRoleAccess = z.infer<typeof MyAccessSchema>;
export const getMyRoleAccess = auth().handler(async ({ context }) => MyAccessSchema.parse(await rpc(context, "my_role_access")));

/* ---------------- Auditor ---------------- */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const getAuditorHistory = auth().inputValidator(z.object({ from: date, to: date, offset: z.number().int().min(0).max(100000).default(0) }))
  .handler(async ({ data, context }) => z.array(z.object({
    at: z.string(), action: z.string(), target_table: z.string().nullable(), target_id: z.string().nullable(),
    actor_name: z.string(), metadata: z.record(z.string(), z.unknown()).nullable(),
  })).parse((await rpc(context, "auditor_finance_history", { _from: data.from, _to: data.to, _limit: 50, _offset: data.offset })) ?? []));

/* ---------------- Staff ---------------- */

const StaffCtxSchema = z.object({
  society_name: z.string().nullable(), full_name: z.string(), job_type: z.string(),
  shift_start: z.string().nullable(), shift_end: z.string().nullable(), shift_days: z.array(z.number()).nullable(),
  permissions: z.array(z.string()).nullable(),
  attendance: z.array(z.object({ day: z.string(), status: z.string() })),
});
export type StaffContext = z.infer<typeof StaffCtxSchema>;
export const getStaffContext = auth().handler(async ({ context }) => StaffCtxSchema.parse(await rpc(context, "staff_my_context")));

const TicketSchema = z.object({
  id: uuid, ticket_no: z.number(), subject: z.string(), description: z.string().nullable(), category: z.string(),
  priority: z.string(), status: z.string(), sla_due_at: z.string().nullable(), created_at: z.string(),
  asset_name: z.string().nullable(), asset_location: z.string().nullable(), flat_label: z.string().nullable(), hold_reason: z.string().nullable(),
});
export type StaffTicket = z.infer<typeof TicketSchema>;
export const listStaffTickets = auth().inputValidator(z.object({ includeDone: z.boolean().default(false) }))
  .handler(async ({ data, context }) => z.array(TicketSchema).parse((await rpc(context, "staff_my_tickets", { _include_done: data.includeDone })) ?? []));

export const getStaffTimeline = auth().inputValidator(z.object({ ticketId: uuid }))
  .handler(async ({ data, context }) => z.array(z.object({
    kind: z.string(), actor_kind: z.string(), from_status: z.string().nullable(), to_status: z.string().nullable(), body: z.string().nullable(), created_at: z.string(),
  })).parse((await rpc(context, "staff_ticket_timeline", { _ticket: data.ticketId })) ?? []));

export const updateStaffTicket = auth().inputValidator(z.object({
  ticketId: uuid, status: z.enum(["in_progress", "on_hold", "resolved"]).nullable(), note: z.string().trim().max(2000).optional(),
})).handler(async ({ data, context }) => { await rpc(context, "staff_update_ticket", { _ticket: data.ticketId, _status: data.status, _note: data.note ?? null }); return { ok: true }; });

export const listStaffAssets = auth().handler(async ({ context }) => z.array(z.object({
  id: uuid, name: z.string(), category: z.string().nullable(), location: z.string().nullable(), status: z.string().nullable(),
  warranty_until: z.string().nullable(), amc_until: z.string().nullable(), last_service: z.string().nullable(),
})).parse((await rpc(context, "staff_list_assets")) ?? []));

export const logStaffAssetService = auth().inputValidator(z.object({ assetId: uuid, kind: z.enum(["repair", "service", "inspection"]), notes: z.string().trim().min(3).max(500) }))
  .handler(async ({ data, context }) => { await rpc(context, "staff_log_asset_service", { _asset: data.assetId, _kind: data.kind, _notes: data.notes }); return { ok: true }; });

export const listStaffInventory = auth().handler(async ({ context }) => z.array(z.object({
  id: uuid, name: z.string(), location: z.string().nullable(), unit: z.string().nullable(), quantity: z.number(), reorder_level: z.number().nullable(),
})).parse((await rpc(context, "staff_list_inventory")) ?? []));

export const consumeStaffInventory = auth().inputValidator(z.object({ itemId: uuid, qty: z.number().positive().max(10000), reason: z.string().trim().min(3).max(200) }))
  .handler(async ({ data, context }) => ({ quantity: Number(await rpc(context, "staff_use_inventory", { _item: data.itemId, _qty: data.qty, _reason: data.reason })) }));

export const listStaffVendors = auth().handler(async ({ context }) => z.array(z.object({
  id: uuid, name: z.string(), category: z.string().nullable(), phone: z.string().nullable(), contract_end: z.string().nullable(),
})).parse((await rpc(context, "staff_list_vendors")) ?? []));

export const listStaffDocuments = auth().handler(async ({ context }) => z.array(z.object({
  id: uuid, title: z.string(), category: z.string().nullable(), file_name: z.string().nullable(), updated_at: z.string(),
})).parse((await rpc(context, "staff_list_documents")) ?? []));

export const openStaffDocument = auth().inputValidator(z.object({ id: uuid })).handler(async ({ data, context }) => {
  // Access is decided by the caller's own session; only then is a short-lived link signed.
  const path = z.string().min(1).parse(await rpc(context, "staff_document_path", { _id: data.id }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: signed, error } = await supabaseAdmin.storage.from("society-knowledge").createSignedUrl(path, 300);
  if (error || !signed?.signedUrl) throw new Error("The document could not be opened.");
  return { url: signed.signedUrl };
});
