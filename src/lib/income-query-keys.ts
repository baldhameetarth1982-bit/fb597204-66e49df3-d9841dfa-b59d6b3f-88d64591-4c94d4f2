/**
 * Stage 1D — central React Query key factory for Non-Member Income.
 *
 * Every key is society-scoped. Filters and page are included so filter/page
 * changes never share cache entries. Mutations invalidate a precise slice
 * rather than the whole app.
 */
export type IncomeCategoryFilter = {
  search?: string;
  active?: "all" | "active" | "inactive";
  kind?: "all" | "system" | "custom";
  group?: string | null;
};

export type IncomePayerFilter = {
  search?: string;
  active?: "all" | "active" | "inactive";
  type?: string | "all";
};

export type IncomeRecordFilter = {
  verification_status?: string;
  reconciliation_status?: string;
  payment_method?: string;
  category_id?: string;
  from_date?: string;
  to_date?: string;
  sort?: string;
};

function canon<T extends Record<string, unknown>>(f: T | undefined): unknown {
  if (!f) return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(f).sort()) {
    const v = (f as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === "" || v === "all") continue;
    out[k] = v;
  }
  return out;
}

export const incomeKeys = {
  root: (societyId: string) => ["society-income", societyId] as const,
  dashboard: (societyId: string, filters?: IncomeRecordFilter) =>
    ["society-income", societyId, "dashboard", canon(filters)] as const,
  records: (societyId: string, filters?: IncomeRecordFilter, page = 0) =>
    ["society-income", societyId, "records", canon(filters), page] as const,
  record: (societyId: string, recordId: string) =>
    ["society-income", societyId, "record", recordId] as const,
  categories: (societyId: string, filters?: IncomeCategoryFilter) =>
    ["society-income", societyId, "categories", canon(filters)] as const,
  activeCategories: (societyId: string) =>
    ["society-income", societyId, "categories", "active"] as const,
  payers: (societyId: string, filters?: IncomePayerFilter, page = 0) =>
    ["society-income", societyId, "payers", canon(filters), page] as const,
  activePayers: (societyId: string) =>
    ["society-income", societyId, "payers", "active"] as const,
  payerDetail: (societyId: string, payerId: string) =>
    ["society-income", societyId, "payer", payerId] as const,
};

/** Precise invalidation targets for each mutation kind. */
export const incomeInvalidations = {
  category: (societyId: string) => [
    ["society-income", societyId, "categories"] as const,
  ],
  payer: (societyId: string, payerId?: string) => {
    const out: readonly unknown[][] = [
      ["society-income", societyId, "payers"] as const,
    ];
    return payerId
      ? [...out, ["society-income", societyId, "payer", payerId] as const]
      : out;
  },
  income: (societyId: string) => [
    ["society-income", societyId, "dashboard"] as const,
    ["society-income", societyId, "records"] as const,
  ],
};
