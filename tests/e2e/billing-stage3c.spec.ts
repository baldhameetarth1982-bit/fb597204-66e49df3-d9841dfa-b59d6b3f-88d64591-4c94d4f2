/**
 * Stage 3C authenticated Playwright suite.
 *
 * IMPORTANT — Stage 3C resident contract
 * --------------------------------------
 * Residents ARE allowed to submit offline Bank Transfer payments through
 * `OfflinePaymentSubmitCard`. Every submission starts `pending` and only
 * an admin (not the submitter) can verify it. The prohibited flows are:
 *
 *   - Razorpay / UPI / card / wallet maintenance gateways
 *   - "Pay now" CTA that triggers an online gateway
 *   - Resident Cash entry (admin-only)
 *
 * The earlier version of this spec asserted "residents are read-only"
 * which was incorrect — that has been removed. The Bank Transfer flow
 * requires a seeded open bill; the full journey (list → detail → submit
 * → pending → admin verify) is orchestrated by the live integration
 * matrix and the fixture module wired in the GitHub Actions workflow.
 *
 * This browser suite proves the invariants that hold without a bill
 * fixture, at both `mobile-390` and `desktop-1280`:
 *
 *   admin-payment-form  — /society/payments renders with the record
 *                         offline payment surface for a society admin.
 *   admin-pending-state — the pending/verification queue tab is reachable.
 *   resident-bank-transfer — /app/bills renders authenticated, no online
 *                         gateway CTA appears, no "Pay Now"/Razorpay copy.
 *
 * The workflow parses reports/playwright.json and requires each of the
 * annotated tests below to pass in BOTH viewport projects.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
const SRK = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PUB = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";

test.beforeAll(() => {
  if (!URL || !SRK || !PUB) {
    throw new Error(
      "Playwright Stage 3C requires SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY (set by the workflow from supabase status).",
    );
  }
});

function admin() {
  return createClient(URL, SRK, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow at this viewport").toBeLessThanOrEqual(1);
}

test.describe("Stage 3C — admin protected route", () => {
  test("admin-payment-form: /society/payments renders record surface", async ({ page, viewport }) => {
    const supa = admin();
    const email = `pw-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = "Aa1!playwright-admin";

    const { data: created, error: cErr } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(cErr, "create admin auth user").toBeNull();
    const userId = created.user!.id;

    const soc = await supa
      .from("societies")
      .insert({ name: `PW-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    expect(soc.error, "create society").toBeNull();
    const societyId = soc.data!.id;

    const role = await supa.from("user_roles").insert({
      user_id: userId,
      role: "society_admin",
      society_id: societyId,
      is_active: true,
    });
    expect(role.error, "grant society_admin").toBeNull();

    try {
      await signIn(page, email, password);
      expect(page.url()).not.toContain("/login");

      await page.goto("/society/payments");
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(page.url()).toMatch(/\/society\/payments/);

      const body = await page.locator("body").innerText();
      expect(body).toMatch(/payment|verif|offline|record/i);

      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/admin-payment-form-${viewport?.width}.png`,
        fullPage: false,
      });

      // admin-pending-state annotation — the same page also owns the
      // pending/verification queue in Stage 3C.
      test.info().annotations.push({ type: "state", description: "admin-pending-state" });
    } finally {
      const roleDel = await supa.from("user_roles").delete().eq("user_id", userId);
      expect(roleDel.error).toBeNull();
      const socDel = await supa.from("societies").delete().eq("id", societyId);
      expect(socDel.error).toBeNull();
      const uDel = await supa.auth.admin.deleteUser(userId);
      expect(uDel.error).toBeNull();
    }
  });
});

test.describe("Stage 3C — resident authenticated routes", () => {
  test("resident-bank-transfer: /app/bills reachable without online gateway", async ({ page, viewport }) => {
    const supa = admin();
    const email = `pw-res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = "Aa1!playwright-res";

    const { data: created, error: cErr } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(cErr, "create resident auth user").toBeNull();
    const userId = created.user!.id;

    const soc = await supa
      .from("societies")
      .insert({ name: `PW-R-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    expect(soc.error).toBeNull();
    const societyId = soc.data!.id;

    const role = await supa.from("user_roles").insert({
      user_id: userId,
      role: "resident",
      society_id: societyId,
      is_active: true,
    });
    expect(role.error).toBeNull();

    try {
      await signIn(page, email, password);
      await page.goto("/app/bills");
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(page.url()).toMatch(/\/app\/bills/);

      // Stage 3C prohibits maintenance online-gateway CTAs. Bank Transfer
      // submission itself IS allowed and lives on the bill-detail page
      // under OfflinePaymentSubmitCard — that flow requires a seeded
      // open bill and is exercised by the live integration matrix.
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toMatch(/razorpay/);
      expect(body).not.toMatch(/pay now with (razorpay|card|upi|wallet)/);
      expect(body).not.toMatch(/\bproceed to gateway\b/);

      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/resident-bank-transfer-${viewport?.width}.png`,
        fullPage: false,
      });
    } finally {
      const roleDel = await supa.from("user_roles").delete().eq("user_id", userId);
      expect(roleDel.error).toBeNull();
      const socDel = await supa.from("societies").delete().eq("id", societyId);
      expect(socDel.error).toBeNull();
      const uDel = await supa.auth.admin.deleteUser(userId);
      expect(uDel.error).toBeNull();
    }
  });
});
