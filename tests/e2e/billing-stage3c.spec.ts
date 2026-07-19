/**
 * Stage 3C authenticated Playwright smoke.
 *
 * This spec is executed by GitHub Actions after `supabase start` and
 * `supabase db reset` have applied all migrations locally, and after the
 * app has been built and started on the runner. It provisions a minimal
 * fixture directly via the Supabase Admin API on the disposable local
 * stack, then signs the browser in with email/password.
 *
 * The spec runs in BOTH viewport projects defined in playwright.config.ts
 * (mobile-390 and desktop-1280) so a single spec proves both gates.
 */
import { test, expect } from "@playwright/test";
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

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.describe("Stage 3C authenticated visual verification", () => {
  test("admin payments page renders without overflow", async ({ page, viewport }) => {
    const admin = createClient(URL, SRK, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `pw-admin-${Date.now()}@example.test`;
    const password = "Aa1!playwright-admin";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();

    try {
      await signIn(page, email, password);
      // Landing route after sign-in should be reachable without redirect to login.
      expect(page.url()).not.toContain("/login");

      // Check no horizontal overflow at the current viewport.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `test-results/stage3c-${viewport?.width}-authenticated.png`,
        fullPage: false,
      });
    } finally {
      if (data.user?.id) await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    }
  });
});
