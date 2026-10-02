import { describe, expect, it, vi } from "vitest";
import { biometricStatus, requireBiometric } from "./biometric";

describe("biometric fallback", () => {
  it("is explicitly unavailable and never self-attests", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    const r = await requireBiometric("open gate");
    expect(r.ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(biometricStatus().available).toBe(false);
    vi.unstubAllGlobals();
  });
});
