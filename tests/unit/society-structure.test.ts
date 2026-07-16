import { describe, it, expect } from "vitest";
import { normalizeLabel, isModeConversionBlocked, type StructureOverview } from "@/lib/society-structure";

describe("Stage 2A — normalizeLabel", () => {
  it("trims and lowercases", () => {
    expect(normalizeLabel("  A-101  ")).toBe("a-101");
    expect(normalizeLabel("A-101")).toBe(normalizeLabel("a-101"));
  });
  it("handles null/undefined/empty", () => {
    expect(normalizeLabel(null)).toBe("");
    expect(normalizeLabel(undefined)).toBe("");
    expect(normalizeLabel("")).toBe("");
  });
});

const baseOverview: StructureOverview = {
  structure_mode: null,
  configured: false,
  total_structures: 0,
  active_structures: 0,
  total_units: 0,
  active_units: 0,
  units_with_block: 0,
  units_without_block: 0,
  inconsistent_units: 0,
};

describe("Stage 2A — isModeConversionBlocked", () => {
  it("does not block when unconfigured", () => {
    expect(isModeConversionBlocked({ ...baseOverview }, "structured")).toBe(false);
    expect(isModeConversionBlocked({ ...baseOverview }, "serial")).toBe(false);
  });
  it("does not block when target equals current mode", () => {
    expect(
      isModeConversionBlocked(
        { ...baseOverview, structure_mode: "structured", configured: true, total_units: 5 },
        "structured",
      ),
    ).toBe(false);
  });
  it("blocks structured -> serial when units exist", () => {
    expect(
      isModeConversionBlocked(
        { ...baseOverview, structure_mode: "structured", configured: true, total_units: 3, units_with_block: 3 },
        "serial",
      ),
    ).toBe(true);
  });
  it("blocks serial -> structured when units exist", () => {
    expect(
      isModeConversionBlocked(
        { ...baseOverview, structure_mode: "serial", configured: true, total_units: 4, units_without_block: 4 },
        "structured",
      ),
    ).toBe(true);
  });
  it("does not block when no units exist yet", () => {
    expect(
      isModeConversionBlocked(
        { ...baseOverview, structure_mode: "structured", configured: true, total_units: 0 },
        "serial",
      ),
    ).toBe(false);
  });
});

describe("Stage 2A — canonical model invariants (documentation)", () => {
  it("documents that flats.block_id is nullable for serial mode", () => {
    // The migration `ALTER TABLE public.flats ALTER COLUMN block_id DROP NOT NULL`
    // is the source of truth. This test only pins the intent.
    expect(true).toBe(true);
  });
  it("documents that hierarchy_nodes is legacy (compat only)", () => {
    // authoritative writes go to blocks + flats via commit_society_wizard
    // and the RPCs in src/lib/society-structure.ts.
    expect(true).toBe(true);
  });
});
