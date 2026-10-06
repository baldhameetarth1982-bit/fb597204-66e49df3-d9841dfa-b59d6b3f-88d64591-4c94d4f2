import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { core } from "@/locales/core";
import { auth } from "@/locales/auth";
import { notifications } from "@/locales/notifications";
import { accounts } from "@/locales/accounts";
import { settings } from "@/locales/settings";
import { resident } from "@/locales/resident";
import { dashboard } from "@/locales/dashboard";
import { navhub } from "@/locales/navhub";
import { profile } from "@/locales/profile";
import { residentPages } from "@/locales/residentPages";

const en: Record<string, string> = {};
for (const c of [core, auth, notifications, accounts, settings, resident, dashboard, navhub, profile, residentPages]) for (const [k, v] of Object.entries(c)) en[k] = v[0];

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
        // An English gloss in brackets ("… (Pause)") means the machine output leaked English.
        if (!/\)\s*$/.test(en[k])) expect(t[k], `${f} ${k}`).not.toMatch(/\s\([A-Za-z][A-Za-z ]+\)\s*$/);
        // Guard tools strings: no English gloss in brackets anywhere in the sentence.
        if (/^(g[dosepahv]|pk|mp|el|sec|nd|dc|pl|mt)\./.test(k) && !en[k].includes("(")) expect(t[k], `${f} ${k}`).not.toMatch(/\([A-Za-z][A-Za-z ]*\)/);
        // Manipuri must be Meitei, not the Bengali language written in the same script.
        if (f === "mni.json") expect(t[k], `${f} ${k}`).not.toMatch(/করুন|হয়েছে|আপনি|এবং/);
      }
    });
  }
});
