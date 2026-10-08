import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static safety contract for the P01–P10 SQL harnesses. Runtime proof comes only from
 * running them on a disposable local database (CI workflow); this file guarantees they
 * cannot commit data, touch non-synthetic records or silently lose key checks.
 */
const suites = [
  { file: "tests/sql/p01-p10-access-billing.sql", tag: "p0110a", prefix: "P0110A_RESULT", uuid: "5d5d0000-",
    checks: ["p01.admA_cross_tenant_update_blocked", "p01.client_supplied_actor_role_cannot_escalate", "p05.server_calculates_total",
      "p05.same_period_not_billed_twice", "p06.pending_has_no_receipt", "p06.client_cannot_fabricate_receipt", "p06.self_verification_blocked",
      "p07.exactly_one_bill_created", "p07.retry_does_not_duplicate", "p07.pending_payment_no_bill", "p07.rejected_payment_no_bill",
      "p07.reversed_payment_no_bill", "p07.lower_plan_no_bill", "p07.amount_mismatch_no_bill", "p07.missing_amount_no_bill",
      "p07.existing_bill_not_duplicated", "p07.blanket_billing_path_retired"] },
  { file: "tests/sql/p01-p10-subscription-entitlement.sql", tag: "p0110b", prefix: "P0110B_RESULT", uuid: "5e5e0000-",
    checks: ["p08.standard_ceiling_setting_is_300", "p08.tampered_amount_rejected", "p08.over_300_checkout_refused",
      "p02.resident_cannot_quote", "p02.admin_cannot_write_plan_or_quantity", "p09.offer_terms_server_calculated",
      "p09.society_cannot_edit_offer_terms", "p09.single_payment_engine", "p09.renewal_same_engine_extends_term",
      "p10.no_purchase_means_unrecorded_not_300", "p10.custom_451st_flat_blocked", "link.other_society_admin_gets_nothing",
      "link.missing_request_reports_unavailable"] },
];

describe.each(suites)("$file safety contract", ({ file, tag, prefix, uuid, checks }) => {
  const sql = readFileSync(join(__dirname, "..", "..", file), "utf8");

  it("is a single DO block that always ends by raising (full rollback)", () => {
    expect(sql.match(new RegExp(`\\bDO \\$${tag}\\$`, "g"))?.length).toBe(1);
    const tail = sql.slice(sql.lastIndexOf("RAISE EXCEPTION"));
    expect(tail.startsWith(`RAISE EXCEPTION '${prefix}|pass=%|fail=%|%|groups=%'`)).toBe(true);
    expect(tail).toMatch(new RegExp(`END \\$${tag}\\$;\\s*$`));
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY|row_security\s*=\s*off/i);
  });

  it("uses only synthetic UUIDs, .invalid emails and [QA] societies", () => {
    const uuids = sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(uuids.filter((u) => !u.startsWith(uuid) && u !== "00000000-0000-0000-0000-000000000000")).toEqual([]);
    expect(sql).toContain("@example.invalid");
    expect(sql).toContain("[QA]");
  });

  it("keeps the key checks", () => {
    for (const name of checks) expect(sql).toContain(`'${name}'`);
  });
});
