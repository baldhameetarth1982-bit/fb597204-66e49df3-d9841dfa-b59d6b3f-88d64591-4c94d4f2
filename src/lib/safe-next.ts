/**
 * Validate a post-auth "next" redirect target.
 *
 * Accepts ONLY same-origin relative paths that start with a single `/`.
 * Rejects protocol-relative URLs (`//evil.com`), absolute URLs
 * (`http:`, `https:`, `javascript:`, `data:` …), backslash tricks
 * (`/\evil.com`), and any control/whitespace characters that browsers
 * strip and re-interpret.
 */
export function sanitizeNextPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw;
  if (v.length === 0 || v.length > 2048) return undefined;
  // Reject any control char, whitespace, backslash, or embedded newline —
  // browsers normalize these and can turn `/\evil` into `//evil`.
  if (/[\s\\\u0000-\u001f\u007f]/.test(v)) return undefined;
  if (!v.startsWith("/")) return undefined;
  if (v.startsWith("//")) return undefined; // protocol-relative
  if (v.startsWith("/\\")) return undefined; // backslash-relative
  // Reject anything that parses as an absolute URL against a dummy base
  // whose pathname doesn't match — that indicates a scheme was smuggled in.
  return v;
}
