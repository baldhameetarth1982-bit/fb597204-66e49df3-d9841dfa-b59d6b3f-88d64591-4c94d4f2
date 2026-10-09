import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Event money: totals per society event from the canonical income and expense
 * rows. Society scope, finance permission and plan are enforced in the RPCs;
 * record lists are read through RLS as the signed-in user.
 */
const uuid = z.string().uuid();

const SAFE = ["not_authorized", "plan_required", "event_not_found", "record_not_found", "invalid_kind", "unauthenticated"];
function safe(e: { message?: string } | null): Error {
  const m = e?.message ?? "";
  return new Error(SAFE.find((k) => m.includes(k)) ?? "request_failed");
}

const Summary = z.array(z.object({
  event_id: uuid, title: z.string(), starts_at: z.string(), status: z.string().nullable(),
  income: z.coerce.number(), income_count: z.coerce.number(),
  expense: z.coerce.number(), expense_count: z.coerce.number(),
}));
export type EventMoney = z.infer<typeof Summary>[number];

export const getEventMoney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("get_event_finance_summary", { _society_id: data.societyId });
    if (error) throw safe(error);
    return Summary.parse(rows ?? []);
  });

const Rec = z.object({ id: uuid, kind: z.enum(["income", "expense"]), amount: z.coerce.number(), date: z.string().nullable(), label: z.string(), event_id: uuid.nullable() });
export type EventMoneyRecord = z.infer<typeof Rec>;

export const listEventMoneyRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const [inc, exp] = await Promise.all([
      sb.from("society_income_records").select("id, amount, payment_date, description, event_id")
        .eq("society_id", data.societyId).eq("verification_status", "verified").order("payment_date", { ascending: false }).limit(60),
      sb.from("expenses").select("id, amount, spent_on, note, category, event_id")
        .eq("society_id", data.societyId).eq("status", "posted").order("spent_on", { ascending: false }).limit(60),
    ]);
    if (inc.error || exp.error) throw safe(inc.error ?? exp.error);
    const rows: EventMoneyRecord[] = [
      ...(inc.data ?? []).map((r: any) => ({ id: r.id, kind: "income" as const, amount: Number(r.amount), date: r.payment_date ? String(r.payment_date).slice(0, 10) : null, label: r.description || "Income", event_id: r.event_id })),
      ...(exp.data ?? []).map((r: any) => ({ id: r.id, kind: "expense" as const, amount: Number(r.amount), date: r.spent_on ?? null, label: r.note || r.category || "Expense", event_id: r.event_id })),
    ];
    return z.array(Rec).parse(rows);
  });

export const setEventMoneyLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, kind: z.enum(["income", "expense"]), recordId: uuid, eventId: uuid.nullable() }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("set_finance_event_link", {
      _society_id: data.societyId, _kind: data.kind, _record_id: data.recordId, _event_id: data.eventId,
    });
    if (error) throw safe(error);
    return { ok: true as const };
  });
