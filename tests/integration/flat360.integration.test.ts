import { describe, expect, it } from "vitest";
import { createSyntheticFlat360Fixture, IDS } from "../helpers/flat360-isolated-fixture";

function serialized(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

describe("Flat 360 isolated tenant and role integration", () => {
  it("allows Society A admin to read Society A residents and family", async () => {
    const snapshot = await createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatA);
    expect(snapshot.identity.society_id).toBe(IDS.societyA);
    expect(snapshot.occupancy.residents[0]?.display_name).toBe("Synthetic Resident A");
    expect(snapshot.family.status).toBe("available");
  });

  it("denies Society A admin when a Society B flat ID is substituted", async () => {
    await expect(createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatB)).rejects.toThrow("NOT_AUTHORIZED");
  });

  it("allows a block admin to read an assigned block flat", async () => {
    const snapshot = await createSyntheticFlat360Fixture().load(IDS.blockAdminA, IDS.flatA);
    expect(snapshot.viewer.role).toBe("block_admin");
    expect(snapshot.identity.block_id).toBe(IDS.blockA);
  });

  it("denies a block admin when another block's flat ID is substituted", async () => {
    await expect(createSyntheticFlat360Fixture().load(IDS.blockAdminA, IDS.flatA2)).rejects.toThrow("NOT_AUTHORIZED");
  });

  it("denies resident and guard roles at the server authorization boundary", async () => {
    const fixture = createSyntheticFlat360Fixture();
    await expect(fixture.load(IDS.residentA, IDS.flatA)).rejects.toThrow("NOT_AUTHORIZED");
    await expect(fixture.load(IDS.guardA, IDS.flatA)).rejects.toThrow("NOT_AUTHORIZED");
  });

  it("binds direct privileged RPC checks to both actor and requested object", async () => {
    const fixture = createSyntheticFlat360Fixture();
    const { probed, invocations } = fixture.attachRpcProbe(IDS.adminA, IDS.societyA, IDS.flatA);
    expect(await probed.isSocietyAdmin(IDS.adminA, IDS.societyA)).toBe(true);
    expect(await probed.isSocietyAdmin(IDS.adminA, IDS.societyB)).toBe(false);
    expect(await probed.isBlockAdminForFlat(IDS.adminA, IDS.flatB)).toBe(false);
    expect(invocations).toContainEqual({ fn: "is_society_admin_for_internal", args: { _actor_id: IDS.adminA, _society_id: IDS.societyB } });
  });

  it("never mixes Society B bills, payments, dues, or financial history into Society A", async () => {
    const snapshot = await createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatA);
    const body = serialized(snapshot);
    expect(body).toContain(IDS.billA);
    expect(body).toContain(IDS.paymentA);
    expect(body).not.toContain(IDS.billB);
    expect(body).not.toContain(IDS.paymentB);
    expect(snapshot.basicFinancial.current_outstanding).toBe(600);
  });

  it("keeps vehicle and occupancy data scoped to the requested society flat", async () => {
    const a = await createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatA);
    const b = await createSyntheticFlat360Fixture().load(IDS.adminB, IDS.flatB);
    expect(serialized(a)).toContain(IDS.vehicleA);
    expect(serialized(a)).not.toContain(IDS.vehicleB);
    expect(serialized(b)).toContain(IDS.vehicleB);
    expect(serialized(b)).not.toContain(IDS.residentA);
  });

  it("locks every advanced and AI section for the Basic plan without querying advanced rows", async () => {
    const fixture = createSyntheticFlat360Fixture();
    const snapshot = await fixture.load(IDS.adminA, IDS.flatA2);
    expect(snapshot.viewer.plan).toBe("basic");
    expect(snapshot.vehicles.status).toBe("locked");
    expect(snapshot.noDues.status).toBe("locked");
    expect(snapshot.aiSummary.entitlement).toBe("locked");
    expect(fixture.calls.some((call) => call.operation === "fetchVehicles" && call.flatId === IDS.flatA2)).toBe(false);
  });

  it("returns Pro financial, vehicle, No-Dues, and AI entitlements without fabricating unsupported sections", async () => {
    const snapshot = await createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatA);
    expect(snapshot.viewer.canViewAdvanced).toBe(true);
    expect(snapshot.advancedFinancial.status).toBe("available");
    expect(snapshot.vehicles.status).toBe("available");
    expect(snapshot.noDues.status).toBe("available");
    expect(snapshot.aiSummary.entitlement).toBe("available");
    for (const section of [snapshot.visitors, snapshot.complaints, snapshot.documents, snapshot.approvals, snapshot.notices]) {
      expect(section.status).toBe("unsupported");
    }
  });

  it("keeps query failure distinct from empty, unsupported, and available states", async () => {
    const snapshot = await createSyntheticFlat360Fixture({ queryError: true }).load(IDS.adminA, IDS.flatA);
    expect(snapshot.family.status).toBe("error");
    expect(snapshot.documents.status).toBe("unsupported");
    expect(snapshot.vehicles.status).toBe("available");
  });

  it("excludes PII, storage paths, and No-Dues certificate secrets from the complete snapshot", async () => {
    const body = serialized(await createSyntheticFlat360Fixture().load(IDS.adminA, IDS.flatA));
    for (const forbidden of ["phone", "email", "aadhaar", "bank_account", "storage_path", "token_hash", "ciphertext", "key_version", "qr_payload"]) {
      expect(body).not.toContain(`\"${forbidden}\"`);
    }
  });

  it("supports serial and structured homes without weakening tenant identity", async () => {
    const fixture = createSyntheticFlat360Fixture();
    const structured = await fixture.load(IDS.adminA, IDS.flatA);
    const serial = await fixture.load(IDS.adminB, IDS.flatB);
    expect(structured.identity).toMatchObject({ society_id: IDS.societyA, is_serial: false, block_id: IDS.blockA });
    expect(serial.identity).toMatchObject({ society_id: IDS.societyB, is_serial: true, block_id: null });
    expect(serial.identity.unit_label).toBe("House 12");
  });
});
