/**
 * Stage 3C — Playwright E2E fixtures.
 *
 * Thin browser-oriented wrapper around the shared runtime fixture
 * module. Exposes the credentials, IDs and application routes each
 * Playwright test needs, plus explicit setup and teardown functions.
 *
 * The full seeded browser matrix (open bill visible on the resident
 * bill list, pending admin Cash payment, verified receipt, VOID
 * receipt) is provisioned inside the GitHub Actions workflow — this
 * module lays down the shape so a fully seeded run and the current
 * source-complete run share the same import surface.
 */
import {
  setupStage3CFixture,
  type Stage3CFixture,
} from "../helpers/stage3c-runtime-fixtures";

export type Stage3CE2EFixture = Stage3CFixture & {
  routes: {
    login: string;
    adminPayments: string;
    residentBills: string;
    residentBillDetail: (billId: string) => string;
  };
  credentials: {
    adminA1: { email: string; password: string };
    adminA2: { email: string; password: string };
    activeResident: { email: string; password: string };
  };
};

export async function setupStage3CE2EFixture(): Promise<Stage3CE2EFixture> {
  const base = await setupStage3CFixture();
  return {
    ...base,
    routes: {
      login: "/login",
      adminPayments: "/society/payments",
      residentBills: "/app/bills",
      residentBillDetail: (billId: string) => `/app/bills/${billId}`,
    },
    credentials: {
      adminA1: { email: base.users.adminA1.email, password: base.users.adminA1.password },
      adminA2: { email: base.users.adminA2.email, password: base.users.adminA2.password },
      activeResident: {
        email: base.users.activeResident.email,
        password: base.users.activeResident.password,
      },
    },
  };
}

export async function teardownStage3CE2EFixture(f: Stage3CE2EFixture): Promise<void> {
  await f.cleanup();
}
