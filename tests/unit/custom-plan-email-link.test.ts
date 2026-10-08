import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandAppLinks, parseRequestParam } from "@/lib/custom-plan-links";

const sql = readFileSync(join(__dirname, "../../drizzle/migrations/0223_p09_custom_plan_email_direct_link.sql"), "utf8");
const ID = "4b4b0000-0000-4000-8000-00000000c001";

describe("custom-plan email direct link", () => {
  it("society admin copy links to the canonical subscription conversation", () => {
    expect(sql).toContain("{{app_url}}/society/subscription?request=' || NEW.request_id::text || '#custom-plan'");
  });
  it("super admin copy links to the canonical custom plans page", () => {
    expect(sql).toContain("{{app_url}}/admin/custom-plans?request=' || NEW.request_id::text");
  });
  it("never puts message body, emails or sender ids into the email", () => {
    expect(sql).not.toMatch(/NEW\.body|NEW\.message|email\b.*\|\||NEW\.sender_id::text/);
    expect(sql).toContain("IS DISTINCT FROM NEW.sender_id");
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN RETURN NEW");
  });
  it("expands the placeholder with the trusted origin only", () => {
    expect(expandAppLinks(`Open: {{app_url}}/admin/custom-plans?request=${ID}`, "https://sociohub.app/"))
      .toBe(`Open: https://sociohub.app/admin/custom-plans?request=${ID}`);
    expect(expandAppLinks("no link", "https://x.app")).toBe("no link");
  });
  it.each(["", "abc", "javascript:alert(1)", `${ID}&x=1`, 42, null])("rejects bad request param %p", (v) => {
    expect(parseRequestParam(v)).toBeUndefined();
  });
  it("accepts a well-formed request id", () => {
    expect(parseRequestParam(ID.toUpperCase())).toBe(ID);
  });
});
