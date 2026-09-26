import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasFeature, normalizePlan, planFromSocietyRow } from "@/lib/plan-features";

const BUCKET = "society-knowledge";
const uuid = z.string().uuid();
const audience = z.enum(["residents", "committee"]);

export type KnowledgeStatus = "processing" | "ready" | "unsupported" | "failed" | "archived";
export type KnowledgeItem = {
  id: string;
  kind: "document" | "faq";
  title: string;
  audience: "residents" | "committee";
  faqAnswer: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  status: KnowledgeStatus;
  statusReason: string | null;
  textChars: number;
  version: number;
  updatedAt: string;
};

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; message: string };

const COLS = "id,kind,title,audience,faq_answer,file_name,size_bytes,status,status_reason,text_chars,version,updated_at";

function mapRow(r: any): KnowledgeItem {
  return {
    id: r.id, kind: r.kind, title: r.title, audience: r.audience, faqAnswer: r.faq_answer ?? null,
    fileName: r.file_name ?? null, sizeBytes: r.size_bytes ?? null, status: r.status, statusReason: r.status_reason ?? null,
    textChars: r.text_chars ?? 0, version: r.version, updatedAt: r.updated_at,
  };
}

function friendly(err: unknown): string {
  const m = String((err as any)?.message ?? err ?? "").toLowerCase();
  if (m.includes("not_authorized")) return "Only society admins can manage documents.";
  if (m.includes("not_found")) return "That document no longer exists.";
  if (m.includes("invalid_transition")) return "This document can't be changed from its current state.";
  if (m.includes("limit_reached")) return "You've reached the limit of 200 knowledge items. Archive or remove some first.";
  if (m.includes("invalid_file")) return "Only PDF, TXT and Markdown files are supported.";
  if (m.includes("invalid_input")) return "Please check the details and try again.";
  return "Something went wrong. Please try again.";
}

/** Server-derived society + admin + plan check. Never trusts a browser society id. */
async function adminScope(supabase: any, userId: string): Promise<{ societyId: string } | Fail> {
  const { data: profile } = await supabase.from("profiles").select("society_id").eq("id", userId).maybeSingle();
  const societyId = profile?.society_id as string | undefined;
  if (!societyId) return { ok: false, message: "Join a society first." };
  const { data: isAdmin } = await supabase.rpc("is_society_admin_for", { _user_id: userId, _society_id: societyId });
  if (!isAdmin) return { ok: false, message: "Only society admins can manage documents." };
  const { data: soc } = await supabase.from("societies").select("plan_id,plan_status,trial_ends_at,plan_expires_at,status").eq("id", societyId).maybeSingle();
  if (!soc || !hasFeature(planFromSocietyRow(soc as any), "ai_secretary")) {
    return { ok: false, message: "AI Secretary knowledge is available on the Pro plan." };
  }
  return { societyId };
}

async function limit(bucket: string, subject: string, max: number) {
  const { checkRateLimit } = await import("@/lib/rate-limit.server");
  try { await checkRateLimit({ bucket, subject, limit: max, windowSec: 3600 }); return true; } catch { return false; }
}

export const listKnowledgeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Ok<{ items: KnowledgeItem[] }> | Fail> => {
    const supabase = context.supabase as any;
    const scope = await adminScope(supabase, context.userId);
    if ("ok" in scope) return scope;
    const { data, error } = await supabase.from("society_knowledge_sources").select(COLS)
      .eq("society_id", scope.societyId).order("updated_at", { ascending: false }).limit(200);
    if (error) return { ok: false, message: "Couldn't load documents. Please try again." };
    return { ok: true, items: (data ?? []).map(mapRow) };
  });

export const uploadKnowledgeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error("invalid_input");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("invalid_input");
    const replaceId = d.get("replaceId");
    return {
      file,
      title: z.string().trim().min(3).max(160).parse(d.get("title")),
      audience: audience.parse(d.get("audience")),
      replaceId: replaceId ? uuid.parse(replaceId) : null,
    };
  })
  .handler(async ({ data, context }): Promise<Ok<{ status: KnowledgeStatus; reason: string | null }> | Fail> => {
    const supabase = context.supabase as any;
    const scope = await adminScope(supabase, context.userId);
    if ("ok" in scope) return scope;
    if (!(await limit("knowledge_upload_user", context.userId, 30))) return { ok: false, message: "Too many uploads. Please try again in a while." };

    const { detectKnowledgeFile, extractKnowledgeText, safeFileName } = await import("@/lib/society-knowledge.server");
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const kind = detectKnowledgeFile(data.file.name, data.file.type, bytes);
    if ("error" in kind) return { ok: false, message: kind.error };

    const { data: begun, error: beginErr } = await supabase.rpc("knowledge_begin_document", {
      _title: data.title, _audience: data.audience, _file_name: safeFileName(data.file.name), _mime: kind.mime,
      _size: bytes.byteLength, _ext: kind.ext, _replace_id: data.replaceId,
    });
    if (beginErr || !begun) return { ok: false, message: friendly(beginErr) };
    const { id, version, path, old_path: oldPath } = begun as { id: string; version: number; path: string; old_path: string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const finish = (status: string, text: string | null, reason: string | null) =>
      supabase.rpc("knowledge_finish_document", { _id: id, _version: version, _status: status, _text: text, _reason: reason });

    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: true });
    if (up.error) {
      console.error("knowledge_upload_storage_failed");
      await finish("failed", null, "The file couldn't be stored. Please upload it again.");
      return { ok: true, status: "failed", reason: "The file couldn't be stored. Please upload it again." };
    }
    if (oldPath && oldPath !== path) await supabaseAdmin.storage.from(BUCKET).remove([oldPath]);

    const result = await extractKnowledgeText(kind, bytes);
    const fin = result.status === "ready" ? await finish("ready", result.text, null) : await finish(result.status, null, result.reason);
    if (fin.error) return { ok: false, message: friendly(fin.error) };
    return { ok: true, status: result.status, reason: result.status === "ready" ? null : result.reason };
  });

export const saveKnowledgeFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: uuid.nullable(),
    question: z.string().trim().min(3).max(160),
    answer: z.string().trim().min(5).max(4000),
    audience,
  }).parse(d))
  .handler(async ({ data, context }): Promise<Ok<{}> | Fail> => {
    const supabase = context.supabase as any;
    const scope = await adminScope(supabase, context.userId);
    if ("ok" in scope) return scope;
    if (!(await limit("knowledge_edit_user", context.userId, 120))) return { ok: false, message: "Too many changes. Please try again later." };
    const answer = data.answer.replace(/<[^>]*>/g, " ");
    const { error } = await supabase.rpc("knowledge_upsert_faq", { _id: data.id, _question: data.question, _answer: answer, _audience: data.audience });
    if (error) return { ok: false, message: friendly(error) };
    return { ok: true };
  });

export const setKnowledgeArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, archived: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<Ok<{}> | Fail> => {
    const supabase = context.supabase as any;
    const scope = await adminScope(supabase, context.userId);
    if ("ok" in scope) return scope;
    const { error } = await supabase.rpc("knowledge_set_archived", { _id: data.id, _archived: data.archived });
    if (error) return { ok: false, message: friendly(error) };
    return { ok: true };
  });

export const deleteKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<Ok<{}> | Fail> => {
    const supabase = context.supabase as any;
    const scope = await adminScope(supabase, context.userId);
    if ("ok" in scope) return scope;
    const { data: res, error } = await supabase.rpc("knowledge_delete", { _id: data.id });
    if (error) return { ok: false, message: friendly(error) };
    const path = (res as { path?: string | null })?.path;
    if (path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
    }
    return { ok: true };
  });

/** Short-lived link, only after the database confirms this user may see the document. */
export const openKnowledgeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<Ok<{ url: string }> | Fail> => {
    const supabase = context.supabase as any;
    if (!(await limit("knowledge_open_user", context.userId, 120))) return { ok: false, message: "Too many requests. Please try again later." };
    const { data: path, error } = await supabase.rpc("knowledge_document_path", { _id: data.id });
    if (error || !path) return { ok: false, message: "This document isn't available." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path as string, 300);
    if (sErr || !signed?.signedUrl) return { ok: false, message: "This document isn't available right now." };
    return { ok: true, url: signed.signedUrl };
  });

export type ResidentKnowledgeItem = { id: string; kind: "document" | "faq"; title: string; answer: string | null; fileType: string | null; sizeBytes: number | null; updatedAt: string };

export const listResidentKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Ok<{ items: ResidentKnowledgeItem[] }> | Fail> => {
    const supabase = context.supabase as any;
    const { data: profile } = await supabase.from("profiles").select("society_id").eq("id", context.userId).maybeSingle();
    if (!profile?.society_id) return { ok: false, message: "Join a society to see its documents." };
    // RLS returns only ready, resident-visible items of the caller's own society.
    const { data, error } = await supabase.from("society_knowledge_sources").select("id,kind,title,faq_answer,file_name,size_bytes,updated_at")
      .eq("society_id", profile.society_id).eq("status", "ready").eq("audience", "residents")
      .order("updated_at", { ascending: false }).limit(200);
    if (error) return { ok: false, message: "Couldn't load documents. Please try again." };
    return { ok: true, items: (data ?? []).map((r: any) => ({
      id: r.id, kind: r.kind, title: r.title, answer: r.kind === "faq" ? r.faq_answer : null,
      fileType: r.kind === "document" && r.file_name ? (String(r.file_name).split(".").pop() ?? "").toUpperCase().slice(0, 4) || null : null,
      sizeBytes: r.kind === "document" ? r.size_bytes ?? null : null,
      updatedAt: r.updated_at,
    })) };
  });
