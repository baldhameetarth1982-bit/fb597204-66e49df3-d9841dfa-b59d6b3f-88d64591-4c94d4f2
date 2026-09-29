// Offline guard queue. ONLY two low-risk kinds are allowlisted: a walk-in
// (which always arrives as "waiting for approval") and marking a visitor as
// exited. Every item carries a one-time id; the server re-authorizes, dedupes
// and reports conflicts. Nothing else may ever be queued.
import { supabase } from "@/integrations/supabase/client";

export const OFFLINE_KINDS = ["walkin", "checkout"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];
export type QueueState = "waiting" | "sending" | "sent" | "conflict" | "failed";

export interface QueueItem {
  op_id: string;
  kind: OfflineKind;
  label: string;
  payload: Record<string, string>;
  state: QueueState;
  message?: string;
  queued_at: string;
}

const KEY = "sociyohub.gate.offline.v1";
const MAX = 50;

export function loadQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueueItem[];
    return Array.isArray(raw) ? raw.filter((i) => (OFFLINE_KINDS as readonly string[]).includes(i.kind)) : [];
  } catch {
    return [];
  }
}

function save(items: QueueItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
  window.dispatchEvent(new Event("gate-queue"));
}

export function enqueue(kind: OfflineKind, label: string, payload: Record<string, string>): QueueItem {
  if (!(OFFLINE_KINDS as readonly string[]).includes(kind)) throw new Error("not_allowed_offline");
  const items = loadQueue();
  if (kind === "walkin" && !payload.flat_label?.trim()) throw new Error("flat_required_offline");
  if (items.filter((i) => i.state === "waiting" || i.state === "failed").length >= MAX) throw new Error("queue_full");
  const item: QueueItem = { op_id: crypto.randomUUID(), kind, label, payload, state: "waiting", queued_at: new Date().toISOString() };
  save([...items, item]);
  return item;
}

export function removeItem(op_id: string) {
  save(loadQueue().filter((i) => i.op_id !== op_id));
}

export function clearFinished() {
  save(loadQueue().filter((i) => i.state !== "sent"));
}

let flushing = false;
/** Replays waiting/failed items once. Server confirmation is the only success signal. */
export async function flushQueue(): Promise<{ sent: number; conflicts: number; failed: number }> {
  const out = { sent: 0, conflicts: 0, failed: 0 };
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return out;
  flushing = true;
  try {
    for (const item of loadQueue()) {
      if (item.state !== "waiting" && item.state !== "failed") continue;
      const { data, error } = await supabase.rpc("guard_offline_replay", {
        _op_id: item.op_id, _kind: item.kind, _payload: item.payload,
      });
      const items = loadQueue();
      const idx = items.findIndex((i) => i.op_id === item.op_id);
      if (idx < 0) continue;
      if (error) {
        const offline = /fetch|network/i.test(error.message ?? "");
        items[idx] = { ...items[idx], state: offline ? "waiting" : "failed", message: error.message };
        if (offline) { save(items); break; }
        out.failed++;
      } else {
        const r = data as { result?: string; current_status?: string } | null;
        if (r?.result === "conflict") {
          items[idx] = { ...items[idx], state: "conflict", message: `Already ${r.current_status ?? "changed"} on the server` };
          out.conflicts++;
        } else {
          items[idx] = { ...items[idx], state: "sent", message: undefined };
          out.sent++;
        }
      }
      save(items);
    }
  } finally {
    flushing = false;
  }
  return out;
}
