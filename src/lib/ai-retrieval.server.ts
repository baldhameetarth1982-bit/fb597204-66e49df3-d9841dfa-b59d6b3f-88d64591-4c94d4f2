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
