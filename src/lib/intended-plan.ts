/** Plan picked before society setup (display hint only; the server prices and checks everything at payment). */
export type IntendedTerm = 1 | 3 | 12;
const KEY = "sociohub:intended-plan";

export function saveIntendedPlan(v: { plan: string; term: IntendedTerm }) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
}

export function readIntendedPlan(): { plan: "basic" | "pro" | "premium"; term: IntendedTerm } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && ["basic", "pro", "premium"].includes(v.plan) && [1, 3, 12].includes(v.term)) return v;
  } catch { /* ignore */ }
  return null;
}
