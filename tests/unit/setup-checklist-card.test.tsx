/**
 * Stage 2E — SetupChecklistCard behavior contract.
 *
 * The card consumes the server-derived checklist (getSetupChecklist), and
 * derives its rendered items via the pure `buildChecklistItems` helper.
 * We test the helper directly — no DOM required — and separately assert
 * that the component wires the server function into React Query.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildChecklistItems } from "@/components/society/SetupChecklistCard";

const empty = {
  has_blocks: false, has_flats: false, has_residents: false, has_completed_imports: false,
  blocks: 0, flats: 0, active_residents: 0, completed_imports: 0,
};

describe("Stage 2E — buildChecklistItems (server-derived checklist)", () => {
  it("marks import as optional and excludes it from required completion", () => {
    const items = buildChecklistItems({
      ...empty,
      has_blocks: true, has_flats: true, has_residents: true,
      blocks: 1, flats: 10, active_residents: 5,
    });
    const importItem = items.find((i) => i.key === "import")!;
    expect(importItem.optional).toBe(true);
    // Required-only completeness: import excluded.
    const requiredDone = items.filter((i) => !i.optional).every((i) => i.done);
    // structure/units/residents done, but team/privacy remain review items.
    expect(requiredDone).toBe(false);
  });

  it("shows missing units as incomplete", () => {
    const items = buildChecklistItems(empty);
    const units = items.find((i) => i.key === "units")!;
    expect(units.done).toBe(false);
  });

  it("marks structure done when either blocks or flats exist (serial-mode friendly)", () => {
    expect(buildChecklistItems({ ...empty, has_flats: true, flats: 1 })
      .find((i) => i.key === "structure")!.done).toBe(true);
    expect(buildChecklistItems({ ...empty, has_blocks: true, blocks: 1 })
      .find((i) => i.key === "structure")!.done).toBe(true);
  });

  it("residents completion reflects has_residents", () => {
    expect(buildChecklistItems(empty).find((i) => i.key === "residents")!.done).toBe(false);
    expect(buildChecklistItems({ ...empty, has_residents: true, active_residents: 3 })
      .find((i) => i.key === "residents")!.done).toBe(true);
  });

  it("import step reflects has_completed_imports", () => {
    expect(buildChecklistItems(empty).find((i) => i.key === "import")!.done).toBe(false);
    expect(buildChecklistItems({ ...empty, has_completed_imports: true, completed_imports: 2 })
      .find((i) => i.key === "import")!.done).toBe(true);
  });
});

describe("Stage 2E — SetupChecklistCard wires getSetupChecklist", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/society/SetupChecklistCard.tsx"), "utf8",
  );
  it("imports and invokes getSetupChecklist via useServerFn", () => {
    expect(src).toMatch(/from "@\/lib\/migration\.functions"/);
    expect(src).toMatch(/useServerFn\(getSetupChecklist\)/);
    expect(src).toMatch(/society_id:\s*societyId/);
  });
  it("fails closed (no fake ticks) when the server call errors", () => {
    expect(src).toMatch(/isError[\s\S]*Setup checklist unavailable/);
  });
  it("is mounted on the society dashboard", () => {
    const dash = readFileSync(
      join(process.cwd(), "src/routes/_society/society.dashboard.tsx"), "utf8",
    );
    expect(dash).toMatch(/SetupChecklistCard/);
  });
});
