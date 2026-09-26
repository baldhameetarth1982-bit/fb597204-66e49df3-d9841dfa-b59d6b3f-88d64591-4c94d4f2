import { describe, expect, it } from "vitest";
import { userMessage } from "@/lib/user-error";

describe("userMessage", () => {
  it("passes intentional human messages through", () => {
    expect(userMessage(new Error("Invite code has expired"))).toBe("Invite code has expired");
  });
  it("hides database and token details", () => {
    for (const m of [
      'duplicate key value violates unique constraint "flats_pkey"',
      'relation "public.bills" does not exist',
      "new row violates row-level security policy for table payments",
      "JWT expired",
      "function public.x(uuid) does not exist",
    ]) {
      expect(userMessage(new Error(m), "Save failed")).toBe("Save failed");
    }
  });
  it("maps network failures to an offline message", () => {
    expect(userMessage(new TypeError("Failed to fetch"))).toMatch(/offline/);
  });
  it("uses the fallback for empty or unknown values", () => {
    expect(userMessage(null, "Oops")).toBe("Oops");
  });
});
