/**
 * Custom-plan email deep links. The database writes a relative, ID-only path
 * behind the `{{app_url}}` placeholder; the dispatcher swaps in the public
 * origin at send time. The link carries only the request UUID — never message
 * text, emails or tokens — and the destination page re-checks access via RLS.
 */
export const APP_URL_PLACEHOLDER = "{{app_url}}";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts only a well-formed UUID from the URL; anything else is ignored. */
export function parseRequestParam(v: unknown): string | undefined {
  return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : undefined;
}

/** Replaces the placeholder with the trusted server origin (no trailing slash). */
export function expandAppLinks(body: string, origin: string): string {
  return body.split(APP_URL_PLACEHOLDER).join(origin.replace(/\/+$/, ""));
}
