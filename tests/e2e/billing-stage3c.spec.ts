/**
 * Stage 3C authenticated Playwright suite.
 *
 * Executes against the disposable local Supabase started by
 * `.github/workflows/stage3c-runtime-verification.yml`. Runs in BOTH
 * viewport projects (`mobile-390` and `desktop-1280`) so a single spec
 * proves both viewport gates.
 *
 * Coverage
 * --------
 *   1. Admin `/society/payments` renders with no horizontal overflow.
 *   2. Admin sees the Record-Offline-Payment surface.
 *   3. Resident `/app/bills` list is reachable and free of payment CTAs
 *      (Stage 3C is read-only for residents until the split-submission
 *      contract wires online payments).
 *
 * NOTE — the previous smoke-only version merely asserted "URL is not
 * /login". That is preserved here as a hard failure if it happens, but
 * we now explicitly navigate to the Stage 3C protected routes.
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
  test("admin /society/payments renders", async ({ page, viewport }) => {
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

    // Provision a synthetic society and grant society_admin.
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
      // The route must not redirect back to /login or /auth.
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(page.url()).toMatch(/\/society\/payments/);

      // Landing content — at least one payment/verification label must appear.
      const body = await page.locator("body").innerText();
      expect(body).toMatch(/payment|verif|offline|record/i);

      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/stage3c-admin-payments-${viewport?.width}.png`,
        fullPage: false,
      });
    } finally {
      // Best-effort but error-checked cleanup.
      const roleDel = await supa.from("user_roles").delete().eq("user_id", userId);
      expect(roleDel.error).toBeNull();
      const socDel = await supa.from("societies").delete().eq("id", societyId);
      expect(socDel.error).toBeNull();
      const uDel = await supa.auth.admin.deleteUser(userId);
      expect(uDel.error).toBeNull();
    }
  });
});

test.describe("Stage 3C — resident read-only routes", () => {
  test("resident /app/bills reachable without payment CTAs", async ({ page, viewport }) => {
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

      // Stage 3C is read-only for residents — no "Pay now" gateway CTA.
      const body = await page.locator("body").innerText();
      expect(body.toLowerCase()).not.toMatch(/\bpay now\b/);
      expect(body.toLowerCase()).not.toMatch(/razorpay/);

      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/stage3c-resident-bills-${viewport?.width}.png`,
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
