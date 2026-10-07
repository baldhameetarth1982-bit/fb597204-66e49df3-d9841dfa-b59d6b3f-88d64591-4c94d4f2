import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { personalKindRoute, safeResidentLink } from "@/lib/notification-links";

/**
 * Phase 4C — notification deep links.
 * Route safety is tested here; that the destination re-checks access for a
 * swapped record ID is proven against real RLS by the database security
 * suite (tests/sql/phase4b-security-boundaries.sql, `link.*` checks).
 */
const root = join(__dirname, "..", "..");

/** Every literal resident path the database writes into notification links. */
function serverLinkPaths(): string[] {
  const dir = join(root, "drizzle/migrations");
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/'(\/app\/[A-Za-z0-9_\/-]*)'/g)) found.add(m[1].replace(/\/$/, ""));
  }
  return [...found];
}

function routeExists(path: string): boolean {
  const seg = path.replace(/^\/app\/?/, "");
  const base = seg ? `app.${seg.split("/").join(".")}` : "app";
  const dir = join(root, "src/routes/_resident");
  return [`${base}.tsx`, `${base}.index.tsx`, `${base}.$id.tsx`].some((f) => existsSync(join(dir, f)));
}

describe("Phase 4C notification deep links — resident centre", () => {
  it.each([
    ["Meetings", "/app/meetings"],
    ["Elections", "/app/elections"],
    ["Polls/Votes", "/app/votes"],
    ["Surveys", "/app/surveys"],
    ["Notices", "/app/notices"],
    ["Complaints", "/app/helpdesk"],
    ["Documents", "/app/documents"],
    ["Bill detail keeps record id", "/app/bills/4b4b0000-0000-4000-8000-00000000a041"],
    ["query string record id", "/app/meetings?m=4b4b0000-0000-4000-8000-00000000a081"],
  ])("%s link opens its intended page with the record id preserved", (_n, link) => {
    expect(safeResidentLink(link, "/app/notifications")).toBe(link);
  });

  it.each([
    "https://evil.example/app/bills",
    "//evil.example/app",
    "/app//evil.example",
    "javascript:alert(1)",
    "/society/dashboard",
    "/admin/users",
    "/app/../society/dashboard",
    "/app/bills/<script>",
    "",
    null,
    42,
  ])("unsafe link %p falls back to the type's list page", (link) => {
    expect(safeResidentLink(link, "/app/helpdesk")).toBe("/app/helpdesk");
  });

  it("unknown notification types keep the safe fallback (Notifications, never Dashboard)", () => {
    expect(personalKindRoute("something_new")).toEqual({ cat: "helpdesk", to: "/app/notifications" });
    expect(personalKindRoute("notice").cat).toBe("notices");
    expect(personalKindRoute("payment").cat).toBe("billing");
    expect(personalKindRoute("visitor_entered").to).toBe("/app/visitors");
  });

  it("every resident link the server writes passes the safety check and has a real page", () => {
    const paths = serverLinkPaths();
    expect(paths.length).toBeGreaterThan(10);
    const missing = paths.filter((p) => safeResidentLink(p, "x") !== p || !routeExists(p));
    expect(missing).toEqual([]);
  });

  it("the notification centre uses the shared rules", () => {
    const page = readFileSync(join(root, "src/routes/_resident/app.notifications.tsx"), "utf8");
    expect(page).toContain("safeResidentLink(n.link, m.to)");
    expect(page).toContain("personalKindRoute(n.kind)");
  });
});

describe("Phase 4C notification deep links — push (service worker)", () => {
  const sw = readFileSync(join(root, "public/firebase-messaging-sw.js"), "utf8");
  const start = sw.indexOf("const ALLOWED_NOTIFICATION_PATHS");
  const end = sw.indexOf("messaging.onBackgroundMessage");
  const ctx: Record<string, unknown> = { self: { location: { origin: "https://app.example" } }, URL };
  vm.runInNewContext(`${sw.slice(start, end)}; this.notificationPath = notificationPath;`, ctx);
  const notificationPath = ctx.notificationPath as (d: unknown) => string;

  it.each([
    [{ path: "/app/meetings" }, "/app/meetings"],
    [{ link: "/app/bills/4b4b0000-0000-4000-8000-00000000a041" }, "/app/bills/4b4b0000-0000-4000-8000-00000000a041"],
    [{ path: "/society/dashboard" }, "/society/dashboard"],
    [{ path: "https://evil.example/app" }, "/"],
    [{ path: "//evil.example/app" }, "/"],
    [{ path: "/unknown-area" }, "/"],
    [{}, "/"],
    [null, "/"],
  ])("push data %j opens %s", (data, expected) => {
    expect(notificationPath(data)).toBe(expected);
  });
});
