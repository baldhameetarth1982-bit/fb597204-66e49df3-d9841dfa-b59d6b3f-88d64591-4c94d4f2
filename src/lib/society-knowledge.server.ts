/**
 * Society knowledge documents — file validation + text extraction (server only).
 * Uploaded content is untrusted: we only ever keep plain text, never markup or
 * scripts, and AI Secretary fences it as data.
 */
export const MAX_KNOWLEDGE_BYTES = 5 * 1024 * 1024;
export const MAX_KNOWLEDGE_TEXT = 120_000;
export const MIN_READABLE_CHARS = 40;

export type KnowledgeFileKind = { ext: "pdf" | "txt" | "md"; mime: "application/pdf" | "text/plain" | "text/markdown" };

const EXT_MAP: Record<string, KnowledgeFileKind> = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  txt: { ext: "txt", mime: "text/plain" },
  md: { ext: "md", mime: "text/markdown" },
};

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
}

/** Validates extension, declared type, size and actual content signature. */
export function detectKnowledgeFile(name: string, declaredMime: string, bytes: Uint8Array): KnowledgeFileKind | { error: string } {
  if (bytes.byteLength === 0) return { error: "The file is empty." };
  if (bytes.byteLength > MAX_KNOWLEDGE_BYTES) return { error: "Files must be 5 MB or smaller." };
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const kind = EXT_MAP[ext];
  if (!kind) return { error: "Only PDF, TXT and Markdown (.md) files are supported." };
  const mime = (declaredMime || "").toLowerCase().split(";")[0].trim();
  if (kind.ext === "pdf") {
    if (mime && mime !== "application/pdf") return { error: "This file doesn't look like a PDF." };
    const sig = String.fromCharCode(...bytes.slice(0, 5));
    if (sig !== "%PDF-") return { error: "This file doesn't look like a real PDF." };
  } else {
    if (mime && !["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"].includes(mime)) return { error: "This file isn't a plain text document." };
    if (bytes.slice(0, 8192).includes(0)) return { error: "This file isn't a plain text document." };
  }
  return kind;
}

/** Keep only readable plain text. */
export function cleanExtractedText(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_KNOWLEDGE_TEXT);
}

export function readableCharCount(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export type ExtractResult = { status: "ready"; text: string } | { status: "unsupported" | "failed"; reason: string };

export async function extractKnowledgeText(kind: KnowledgeFileKind, bytes: Uint8Array): Promise<ExtractResult> {
  let raw = "";
  try {
    if (kind.ext === "pdf") {
      const { getDocumentProxy, extractText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      raw = (Array.isArray(text) ? text : [text]).join("\n\n");
    } else {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? "").toLowerCase();
    if (msg.includes("password") || msg.includes("encrypt")) return { status: "unsupported", reason: "This PDF is password-protected. Upload an unlocked copy." };
    if (kind.ext !== "pdf") return { status: "unsupported", reason: "This text file isn't UTF-8 encoded. Save it as UTF-8 and upload again." };
    return { status: "failed", reason: "We couldn't read this PDF. It may be damaged — try exporting it again." };
  }
  const text = cleanExtractedText(raw);
  if (readableCharCount(text) < MIN_READABLE_CHARS) {
    return { status: "unsupported", reason: kind.ext === "pdf" ? "No readable text found. Scanned or image-only PDFs aren't supported yet — upload a text-based PDF." : "This file has almost no readable text." };
  }
  return { status: "ready", text };
}
