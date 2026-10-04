import { cacheGet, cacheSet } from "./offline-cache";

export interface EmergencyContact {
  label: string;
  number: string;
  category: "national" | "society";
}

export const DEFAULT_EMERGENCY_CONTACTS: EmergencyContact[] = [
  { label: "Police", number: "100", category: "national" },
  { label: "Fire", number: "101", category: "national" },
  { label: "Ambulance", number: "102", category: "national" },
  { label: "National Emergency", number: "112", category: "national" },
  { label: "Women Helpline", number: "1091", category: "national" },
  { label: "Disaster Management", number: "108", category: "national" },
];

const KEY = "emergency-contacts";

// Society numbers are cached per society so switching societies never shows
// another society's contacts.
const keyFor = (societyId?: string | null) => (societyId ? `${KEY}:${societyId}` : KEY);

export function loadEmergencyContacts(societyId?: string | null): EmergencyContact[] {
  return (societyId ? cacheGet<EmergencyContact[]>(keyFor(societyId)) : null) ?? DEFAULT_EMERGENCY_CONTACTS;
}

export function saveEmergencyContacts(list: EmergencyContact[], societyId?: string | null) {
  cacheSet(keyFor(societyId), list);
}
