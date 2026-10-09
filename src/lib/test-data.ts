import { useEffect, useState } from "react";

/**
 * Super Admin view filter for synthetic QA / test / demo records.
 * Hiding is display-only: nothing is deleted and access rules are unchanged.
 */
const PATTERNS: RegExp[] = [
  /\[(qa|test)\]/i,
  /\(test only\)/i,
  /\b(demo|test)\s+(society|resident|admin|guard|committee|user)\b/i,
  /\(demo\)/i,
  /^s\d{1,2}\s+test\b/i,
  /\bstage\s*\d+\s+verification\b/i,
  /@sociohub\.live$/i,
  /@(example|test)\.(com|org|in)$/i,
  /^qa[-_.]/i,
];

export function isTestRecord(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => !!v && PATTERNS.some((p) => p.test(v.trim())));
}

const KEY = "sociohub:admin:show-test-data";

export function useShowTestData(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(KEY) === "1"); } catch { /* storage blocked */ }
  }, []);
  const update = (v: boolean) => {
    setShow(v);
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* storage blocked */ }
  };
  return [show, update];
}
