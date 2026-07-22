/**
 * Stage 3C — canonical error-redaction contract behavioral tests.
 * Covers every category listed in the closure spec: JWTs, sb_ keys,
 * Bearer/Authorization headers, cookies, passwords, connection strings,
 * long opaque tokens, protected-society-ID substitution, explicit
 * sensitive-value substitution, and safe error-message extraction.
 */
import { describe, it, expect } from "vitest";
import {
  redactStage3CString,
  redactStage3CUnknown,
  safeStage3CErrorMessage,
  throwStage3CSafeError,
} from "../helpers/stage3c-error-redaction";

const PID = "11111111-1111-1111-1111-111111111111";

describe("Stage 3C canonical redaction — strings", () => {
  it("redacts JWT-shaped tokens", () => {
    const out = redactStage3CString("hi eyJabcdefgh.ijklmnop.qrstuvwx tail");
    expect(out).toContain("[REDACTED_JWT]");
    expect(out).not.toContain("eyJabcdefgh");
  });
  it("redacts sb_secret_ / sb_publishable_ keys", () => {
    const out = redactStage3CString("key sb_secret_ABCDEFGH and sb_publishable_ZZZZ12");
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).not.toContain("sb_secret_ABCDEFGH");
    expect(out).not.toContain("sb_publishable_ZZZZ12");
  });
  it("redacts Stripe/Razorpay-shaped keys", () => {
    const out = redactStage3CString("sk_live_ABCDEFGH12345 rk_test_ZZZZZZZZ pk_test_QQQQQQQQ rzp_live_XYZXYZXY");
    expect(out.match(/\[REDACTED_API_KEY\]/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(out).not.toContain("sk_live_ABCDEFGH");
    expect(out).not.toContain("rzp_live_XYZXYZXY");
  });
  it("redacts Authorization: Bearer headers", () => {
    const out = redactStage3CString("Authorization: Bearer abc.def.ghi");
    expect(out).toContain("[REDACTED_AUTHORIZATION]");
    expect(out).not.toContain("abc.def.ghi");
  });
  it("redacts bare Bearer tokens", () => {
    const out = redactStage3CString("bearer abc.def.ghi tail");
    expect(out).toContain("[REDACTED_BEARER]");
    expect(out).not.toContain("abc.def.ghi");
  });
  it("redacts cookies and set-cookie", () => {
    const out = redactStage3CString('cookie=abc123def; set-cookie: sess=xyz789');
    expect(out).toContain("[REDACTED_COOKIE]");
    expect(out).not.toContain("abc123def");
    expect(out).not.toContain("xyz789");
  });
  it("redacts password and passphrase", () => {
    const out = redactStage3CString("password=hunter2 passphrase: correct-horse");
    expect(out).toContain("[REDACTED_PASSWORD]");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("correct-horse");
  });
  it("redacts service_role literal", () => {
    const out = redactStage3CString("service_role=eyJfake");
    expect(out).toContain("service_role=[REDACTED_SECRET]");
    expect(out).not.toContain("eyJfake");
  });
  it("redacts access/refresh/id tokens by key", () => {
    const out = redactStage3CString('access_token: abc refresh_token=xyz id_token="qqq"');
    expect(out).toContain("[REDACTED_ACCESS_TOKEN]");
    expect(out).toContain("[REDACTED_REFRESH_TOKEN]");
    expect(out).not.toMatch(/[=: ]abc\b/);
    expect(out).not.toContain("xyz");
    expect(out).not.toContain("qqq");
  });
  it("redacts connection strings", () => {
    const out = redactStage3CString("postgres://u:p@host:5432/db and mongodb+srv://a:b@c/d");
    expect(out.match(/\[REDACTED_CONNECTION_STRING\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(out).not.toContain("u:p@host");
    expect(out).not.toContain("a:b@c");
  });
  it("redacts URLs with apikey/access_token query params", () => {
    const out = redactStage3CString("https://example.com/x?apikey=abcd1234 tail");
    expect(out).toContain("[REDACTED_CONNECTION_STRING]");
    expect(out).not.toContain("abcd1234");
  });
  it("redacts very long opaque tokens", () => {
    const longTok = "A".repeat(80);
    const out = redactStage3CString(`tag ${longTok} end`);
    expect(out).toContain("[REDACTED_SECRET]");
    expect(out).not.toContain(longTok);
  });
  it("redacts protected society id when provided", () => {
    const out = redactStage3CString(`society ${PID} row`, { protectedSocietyId: PID });
    expect(out).toContain("[REDACTED_PROTECTED_SOCIETY_ID]");
    expect(out).not.toContain(PID);
  });
  it("redacts protected society id case-insensitively", () => {
    const out = redactStage3CString(`X ${PID.toUpperCase()} Y`, { protectedSocietyId: PID });
    expect(out).toContain("[REDACTED_PROTECTED_SOCIETY_ID]");
  });
  it("does not redact when no rule matches", () => {
    const out = redactStage3CString("nothing sensitive here 12345");
    expect(out).toBe("nothing sensitive here 12345");
  });
  it("does not touch UUID-shaped ids", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    const out = redactStage3CString(`bill=${id}`);
    expect(out).toContain(id);
  });
  it("truncates over maxStringLength", () => {
    const out = redactStage3CString("x".repeat(50), { maxStringLength: 10 });
    expect(out.endsWith("[truncated]")).toBe(true);
  });
  it("returns empty string for non-string input", () => {
    // @ts-expect-error runtime guard
    expect(redactStage3CString(null)).toBe("");
  });
});

describe("Stage 3C canonical redaction — unknown input", () => {
  it("stringifies Error instances safely", () => {
    const err = new Error("boom sb_secret_ABCDEFGH");
    const out = redactStage3CUnknown(err);
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).not.toContain("sb_secret_ABCDEFGH");
  });
  it("stringifies plain error-shaped objects", () => {
    const out = redactStage3CUnknown({ message: "pass password=hunter2", code: 42 });
    expect(out).toContain("[REDACTED_PASSWORD]");
    expect(out).not.toContain("hunter2");
  });
  it("stringifies deeply nested objects — only whitelisted keys are surfaced", () => {
    const err = { message: "sb_secret_ABCDEFGH", nested: { junk: "x" } };
    const out = redactStage3CUnknown(err);
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).not.toContain("sb_secret_ABCDEFGH");
  });
  it("handles circular references without throwing", () => {
    const a: Record<string, unknown> = { message: "root" };
    a.self = a;
    expect(() => redactStage3CUnknown(a)).not.toThrow();
  });
  it("handles null/undefined", () => {
    expect(redactStage3CUnknown(null)).toContain("null");
    expect(redactStage3CUnknown(undefined)).toContain("undefined");
  });
  it("handles numbers/booleans", () => {
    expect(redactStage3CUnknown(42)).toContain("42");
    expect(redactStage3CUnknown(true)).toContain("true");
  });
  it("bounds recursion via maxDepth", () => {
    const deep: Record<string, unknown> = { message: "top" };
    let cur: Record<string, unknown> = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = { message: `d${i}` };
      cur.details = next;
      cur = next;
    }
    expect(() => redactStage3CUnknown(deep, { maxDepth: 3 })).not.toThrow();
  });
});

describe("Stage 3C canonical redaction — safeStage3CErrorMessage", () => {
  it("prefixes stage3c label and redacts", () => {
    const out = safeStage3CErrorMessage("verify-01", new Error("Authorization: Bearer abc.def.ghi"));
    expect(out).toContain("[stage3c:verify-01]");
    expect(out).toContain("[REDACTED_AUTHORIZATION]");
  });
  it("normalizes malformed labels rather than throwing", () => {
    const out = safeStage3CErrorMessage("BAD LABEL!!", "x");
    expect(out).toContain("[stage3c:");
    expect(out).not.toContain("BAD LABEL!!");
  });
  it("throwStage3CSafeError raises a redacted Error", () => {
    expect(() => throwStage3CSafeError("core-x", "sb_secret_ABCDEFGH")).toThrow(/REDACTED_API_KEY/);
  });
});

describe("Stage 3C canonical redaction — idempotency and extra rules", () => {
  it("is idempotent for strings (second pass is a no-op)", () => {
    const inputs = [
      "hi eyJabcdefgh.ijklmnop.qrstuvwx tail",
      "Authorization: Bearer abc.def.ghi",
      "password=hunter2 access_token: abc refresh_token=xyz",
      "postgres://u:p@host/db then sb_secret_ABCDEFGH",
      "https://example.com/x?apikey=abcd1234 tail",
      "SELECT * FROM users WHERE id = 1",
      "path /home/alice/secret.txt and /var/log/app.log",
      "cookie=abc123def; set-cookie: sess=xyz789",
    ];
    for (const s of inputs) {
      const once = redactStage3CString(s);
      const twice = redactStage3CString(once);
      expect(twice).toBe(once);
    }
  });
  it("is idempotent for protected-society-ID substitution", () => {
    const once = redactStage3CString(`row ${PID} bill`, { protectedSocietyId: PID });
    const twice = redactStage3CString(once, { protectedSocietyId: PID });
    expect(twice).toBe(once);
  });
  it("redacts uppercase SQL statements only", () => {
    const out = redactStage3CString("SELECT * FROM users; select a payment");
    expect(out).toContain("[REDACTED_SQL]");
    expect(out).toContain("select a payment");
  });
  it("redacts absolute filesystem paths (Unix + Windows)", () => {
    const out = redactStage3CString("path /home/alice/x.txt and C:\\Users\\a\\y.log tail");
    expect(out.match(/\[REDACTED_PATH\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(out).not.toContain("/home/alice/x.txt");
    expect(out).not.toContain("Users\\a\\y.log");
  });
  it("redacts standalone query-string secrets (no scheme)", () => {
    const out = redactStage3CString("?token=abc123&status=pending&password=hunter2");
    expect(out).toContain("token=[REDACTED_VALUE]");
    expect(out).toContain("password=[REDACTED_VALUE]");
    expect(out).toContain("status=pending");
  });
  it("preserves safe Error diagnostic fields (code/details/hint/status)", () => {
    const err = Object.assign(new Error("boom"), {
      code: "P0001",
      details: "row missing",
      hint: "check id",
      status: 400,
    });
    const out = redactStage3CUnknown(err);
    expect(out).toContain("P0001");
    expect(out).toContain("row missing");
    expect(out).toContain("check id");
    expect(out).toContain("400");
  });
  it("never surfaces Error.cause", () => {
    const inner = new Error("inner sb_secret_ABCDEFGH");
    const outer = new Error("outer");
    (outer as unknown as { cause: unknown }).cause = inner;
    const out = redactStage3CUnknown(outer);
    expect(out).not.toContain("inner");
    expect(out).not.toContain("sb_secret_ABCDEFGH");
  });
  it("serializes NaN/Infinity as [NonFiniteNumber]", () => {
    const out = redactStage3CUnknown({ message: "n", code: NaN, status: Infinity });
    expect(out).toContain("[NonFiniteNumber]");
  });
});
