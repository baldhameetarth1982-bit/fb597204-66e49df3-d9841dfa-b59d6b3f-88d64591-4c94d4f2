import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/safe-next";
import { __test__ as noticeTest } from "@/lib/mcp/tools/list-notices";
import { mcpErrorContent } from "@/lib/mcp/errors";
import * as fs from "node:fs";
import * as path from "node:path";

const { sanitizeNoticeBody } = noticeTest;

describe("sanitizeNextPath (OAuth `next` guard)", () => {
  it("accepts single-slash same-origin path", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/foo/bar?x=1")).toBe("/foo/bar?x=1");
  });
  it("rejects protocol-relative //evil.com", () => {
    expect(sanitizeNextPath("//evil.com")).toBeUndefined();
  });
  it("rejects absolute URLs", () => {
    expect(sanitizeNextPath("https://evil.com")).toBeUndefined();
    expect(sanitizeNextPath("http://evil.com")).toBeUndefined();
    expect(sanitizeNextPath("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeNextPath("data:text/html,x")).toBeUndefined();
  });
  it("rejects backslash tricks", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBeUndefined();
    expect(sanitizeNextPath("/foo\\bar")).toBeUndefined();
  });
  it("rejects control chars, whitespace, newlines", () => {
    expect(sanitizeNextPath("/foo\nbar")).toBeUndefined();
    expect(sanitizeNextPath("/foo\r/bar")).toBeUndefined();
    expect(sanitizeNextPath("/ ")).toBeUndefined();
    expect(sanitizeNextPath("/\u0000")).toBeUndefined();
  });
  it("rejects non-strings and non-slash prefixes", () => {
    expect(sanitizeNextPath(undefined)).toBeUndefined();
    expect(sanitizeNextPath(123)).toBeUndefined();
    expect(sanitizeNextPath("dashboard")).toBeUndefined();
    expect(sanitizeNextPath("")).toBeUndefined();
  });
});

describe("MCP notice body sanitization", () => {
  it("strips HTML tags", () => {
    expect(sanitizeNoticeBody("<b>hi</b> <script>alert(1)</script>there")).toBe("hi alert(1) there");
  });
  it("caps length", () => {
    const long = "a".repeat(2000);
    const out = sanitizeNoticeBody(long);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith("…")).toBe(true);
  });
  it("handles non-strings", () => {
    expect(sanitizeNoticeBody(null)).toBe("");
    expect(sanitizeNoticeBody(undefined)).toBe("");
  });
});

describe("MCP generic error content", () => {
  it("returns a safe generic message and isError=true", () => {
    const r = mcpErrorContent("Unable to load your profile.");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Unable to load your profile.");
    // Must not embed raw DB shapes
    expect(r.content[0].text).not.toMatch(/pg|postgres|supabase|constraint|relation/i);
  });
});

describe("MCP modules do not use service-role key", () => {
  const mcpRoot = path.resolve(__dirname, "../../src/lib/mcp");
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("no SERVICE_ROLE reference anywhere under src/lib/mcp/", () => {
    const files = walk(mcpRoot);
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, `${f} must not reference service role`).not.toMatch(/SERVICE_ROLE/);
      expect(src, `${f} must not import client.server (admin)`).not.toMatch(/client\.server/);
    }
  });
});
