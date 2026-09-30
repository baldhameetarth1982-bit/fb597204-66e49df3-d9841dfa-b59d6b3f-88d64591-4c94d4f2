/**
 * Permission-aware AI retrieval boundary (server only).
 *
 * Every AI feature must read society sources through this module:
 * - the society is resolved from the signed-in user's profile, never the request;
 * - every read uses the caller's RLS-scoped client, so role, audience and
 *   document visibility come from the database policies;
 * - every query is also filtered to that one society (no cross-society reads);
 * - returned text is untrusted data for the model, never instructions.
 */
import type { SecretarySource } from "./ai-secretary.server";

// Structural type so callers can pass the request-scoped Supabase client.
type ScopedClient = { from: (table: string) => any };

export async function resolveCallerSociety(supabase: ScopedClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("society_id").eq("id", userId).maybeSingle();
  return (data?.society_id as string | undefined) ?? null;
}

export class RetrievalFailed extends Error {
  constructor() { super("retrieval"); }
}

/** Reads the society knowledge the caller is allowed to see. */
export async function retrieveSocietySources(supabase: ScopedClient, societyId: string): Promise<SecretarySource[]> {
  const nowIso = new Date().toISOString();
  const [settings, contacts, notices, knowledge] = await Promise.all([
    supabase.from("society_settings").select("bylaws_html,updated_at").eq("society_id", societyId).maybeSingle(),
    supabase.from("society_contacts").select("role_label,name,phone,category").eq("society_id", societyId).order("sort_order").limit(50),
    // RLS limits notices to those addressed to this user's home/block.
    supabase.from("notices").select("title,body,category,publish_at,published_at")
      .eq("society_id", societyId).eq("status", "published").lte("publish_at", nowIso)
      .order("publish_at", { ascending: false }).limit(40),
    // RLS: residents see only ready, resident-audience items; archived/processing never included.
    supabase.from("society_knowledge_sources").select("kind,title,extracted_text,updated_at")
      .eq("society_id", societyId).eq("status", "ready")
      .order("updated_at", { ascending: false }).limit(60),
  ]);
  if (settings.error && contacts.error && notices.error && knowledge.error) throw new RetrievalFailed();

  const out: SecretarySource[] = [];
  if (settings.data?.bylaws_html) {
    out.push({ kind: "bylaws", title: "Society by-laws", text: settings.data.bylaws_html, date: settings.data.updated_at?.slice(0, 10) ?? null, href: "/app/bylaws" });
  }
  if (contacts.data?.length) {
    out.push({
      kind: "contacts",
      title: "Society contacts",
      text: contacts.data.map((c: any) => `${c.role_label ?? c.category ?? "Contact"}: ${c.name}${c.phone ? ` (${c.phone})` : ""}`).join("\n"),
      href: "/app/contacts",
    });
  }
  for (const n of (notices.data ?? []) as any[]) {
    if (!n.title && !n.body) continue;
    const d = (n.publish_at ?? n.published_at ?? "").slice(0, 10) || null;
    out.push({ kind: "notice", title: `Notice: ${String(n.title ?? "Untitled").slice(0, 120)}`, text: `${n.title ?? ""}\n\n${n.body ?? ""}`, date: d, href: "/app/notices" });
  }
  for (const k of (knowledge.data ?? []) as any[]) {
    if (!k.extracted_text) continue;
    const title = String(k.title ?? "Document").slice(0, 120);
    out.push({
      kind: k.kind === "faq" ? "faq" : "document",
      title: k.kind === "faq" ? `FAQ: ${title}` : title,
      text: k.kind === "faq" ? `Q: ${title}\nA: ${k.extracted_text}` : k.extracted_text,
      date: k.updated_at?.slice(0, 10) ?? null,
      href: "/app/documents",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Record summaries (helpdesk request, meeting, needs-attention).       */
/* Same rules: caller's RLS client, server-resolved society, bounded.   */
/* ------------------------------------------------------------------ */

export type SummaryContext = { title: string; text: string; refs: { label: string; href: string }[]; incomplete: boolean };

type RpcClient = ScopedClient & { rpc: (fn: string, args?: Record<string, unknown>) => any };

const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

/** Helpdesk request the caller can already open (RLS), limited to their society. Null when not visible. */
export async function retrieveTicketContext(supabase: ScopedClient, societyId: string, ticketId: string, adminView: boolean): Promise<SummaryContext | null> {
  const t = await supabase.from("support_tickets")
    .select("id,ticket_no,subject,description,status,priority,category,created_at,sla_due_at,escalation_level,escalation_reason,hold_reason,resolution_note,reopened_count")
    .eq("id", ticketId).eq("society_id", societyId).maybeSingle();
  if (t.error) throw new RetrievalFailed();
  if (!t.data) return null;
  const ev = await supabase.from("support_ticket_events").select("kind,from_status,to_status,body,actor_kind,created_at")
    .eq("ticket_id", ticketId).eq("society_id", societyId).order("created_at", { ascending: true }).limit(40);
  const r = t.data as any;
  const lines = [
    `Request #${r.ticket_no}: ${clip(r.subject, 200)}`,
    `Status: ${r.status}; priority: ${r.priority ?? "normal"}; category: ${r.category ?? "other"}; raised ${clip(r.created_at, 10)}`,
    adminView && r.sla_due_at ? `SLA due: ${clip(r.sla_due_at, 16)}; escalation level ${r.escalation_level ?? 0}${r.escalation_reason ? ` (${clip(r.escalation_reason, 200)})` : ""}` : "",
    r.hold_reason ? `On hold because: ${clip(r.hold_reason, 200)}` : "",
    `Description: ${clip(r.description, 2000)}`,
    r.resolution_note ? `Resolution note: ${clip(r.resolution_note, 800)}` : "",
    "Timeline:",
    ...((ev.data ?? []) as any[]).map((e) => `- ${clip(e.created_at, 16)} ${e.actor_kind ?? ""} ${e.kind}${e.to_status ? ` → ${e.to_status}` : ""}${e.body ? `: ${clip(e.body, 400)}` : ""}`),
  ].filter(Boolean);
  return {
    title: `Request #${r.ticket_no}`,
    text: lines.join("\n"),
    refs: [{ label: `Request #${r.ticket_no}`, href: adminView ? "/society/helpdesk" : "/app/helpdesk" }],
    incomplete: !!ev.error || (ev.data?.length ?? 0) >= 40,
  };
}

/** Meeting the caller can already see (RLS), with resolutions and action items when visible. */
export async function retrieveMeetingContext(supabase: ScopedClient, societyId: string, meetingId: string, adminView: boolean): Promise<SummaryContext | null> {
  const m = await supabase.from("meetings").select("id,title,agenda,starts_at,location,status,minutes,cancel_reason")
    .eq("id", meetingId).eq("society_id", societyId).maybeSingle();
  if (m.error) throw new RetrievalFailed();
  if (!m.data) return null;
  const [res, act] = await Promise.all([
    supabase.from("meeting_resolutions").select("seq,text,outcome").eq("meeting_id", meetingId).eq("society_id", societyId).order("seq").limit(30),
    supabase.from("meeting_action_items").select("title,owner_name,due_on,status").eq("meeting_id", meetingId).eq("society_id", societyId).limit(30),
  ]);
  const r = m.data as any;
  // Residents only see minutes once published.
  const minutes = adminView || r.status === "minutes_published" ? r.minutes : null;
  const lines = [
    `Meeting: ${clip(r.title, 200)} — ${clip(r.starts_at, 16)}${r.location ? ` at ${clip(r.location, 120)}` : ""}; status ${r.status}`,
    r.cancel_reason ? `Cancelled: ${clip(r.cancel_reason, 300)}` : "",
    `Agenda: ${clip(r.agenda, 2000)}`,
    minutes ? `Minutes: ${clip(minutes, 4000)}` : "Minutes: not available",
    ...(((res.data ?? []) as any[]).map((x) => `Resolution ${x.seq}: ${clip(x.text, 400)} — ${x.outcome ?? "pending"}`)),
    ...(((act.data ?? []) as any[]).map((x) => `Action: ${clip(x.title, 200)}${x.owner_name ? ` (owner ${clip(x.owner_name, 60)})` : ""}${x.due_on ? ` due ${x.due_on}` : ""} — ${x.status}`)),
  ].filter(Boolean);
  return {
    title: clip(r.title, 120),
    text: lines.join("\n"),
    refs: [{ label: "Meeting details", href: adminView ? "/society/meetings" : "/app/meetings" }],
    incomplete: !minutes || !!res.error || !!act.error,
  };
}

/** Deterministic Needs Attention list for the caller (same RPC the home screen uses). */
export async function retrieveAttentionContext(supabase: RpcClient): Promise<SummaryContext> {
  const { data, error } = await supabase.rpc("get_needs_attention");
  if (error) throw new RetrievalFailed();
  const rows = ((data ?? []) as any[]).slice(0, 25);
  return {
    title: "Needs attention",
    text: rows.length ? rows.map((r) => `- [priority ${r.priority}] ${clip(r.reason, 200)}`).join("\n") : "No items need attention.",
    refs: rows.map((r) => ({ label: clip(r.reason, 80), href: String(r.link ?? "/") })).slice(0, 8),
    incomplete: false,
  };
}
