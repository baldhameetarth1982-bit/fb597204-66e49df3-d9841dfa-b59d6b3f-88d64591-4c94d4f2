import * as fs from "node:fs";
import { operations } from "@/locales/operations";
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

const EN: Record<string, string> = {};
for (const c of [core, auth, notifications, accounts, settings, resident, dashboard, navhub, profile, residentPages, operations]) for (const [k, v] of Object.entries(c)) EN[k] = v[0];

/** Screen files read fixed text via tu("key"); source-contract checks see the English copy in its place. */
export function expandUiText(src: string): string {
  return src
    .replace(/\{tu\("([^"]+)"\)\}/g, (m, k) => (k in EN ? EN[k] : m))
    .replace(/tu\("([^"]+)"\)/g, (m, k) => (k in EN ? JSON.stringify(EN[k]) : m));
}

export const readdirSync = fs.readdirSync;
export function readFileSync(p: fs.PathOrFileDescriptor, enc: BufferEncoding): string {
  const s = fs.readFileSync(p, enc);
  return String(p).endsWith(".tsx") ? expandUiText(s) : s;
}
