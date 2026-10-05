import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { core } from "@/locales/core";
import { auth } from "@/locales/auth";
import { notifications } from "@/locales/notifications";
import { accounts } from "@/locales/accounts";
import { settings } from "@/locales/settings";
import { resident } from "@/locales/resident";

const en: Record<string, string> = {};
for (const c of [core, auth, notifications, accounts, settings, resident]) for (const [k, v] of Object.entries(c)) en[k] = v[0];

const dir = join(process.cwd(), "src/locales/extra");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const toks = (s: string, re: RegExp) => (s.match(re) ?? []).sort().join("|");
const PH = /{{\s*\w+\s*}}/g;

describe("validated extra language bundles", () => {
  it("has bundles", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`${f} covers every key and keeps placeholders, numbers and brand`, () => {
      const t: Record<string, string> = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const k of Object.keys(en)) {
        expect(typeof t[k], `${f} ${k}`).toBe("string");
        expect(t[k].trim().length, `${f} ${k}`).toBeGreaterThan(0);
        expect(toks(t[k], PH), `${f} ${k}`).toBe(toks(en[k], PH));
        expect(toks(t[k].replace(PH, ""), /\d+/g), `${f} ${k}`).toBe(toks(en[k].replace(PH, ""), /\d+/g));
        if (en[k].includes("SociyoHub")) expect(t[k]).toContain("SociyoHub");
        expect(t[k]).not.toMatch(/<script|javascript:/i);
      }
    });
  }
});
