export type DepMethod = "slm" | "wdv";
export interface DepSettings { cost: number; salvage: number; method: DepMethod; life_years: number | null; wdv_rate: number | null; start_date: string }
export interface DepYear { fy: string; opening: number; charge: number; closing: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Indian financial years (Apr–Mar). First year is pro-rated by days held. */
export function depreciationSchedule(s: DepSettings, maxYears = 60): DepYear[] {
  const start = new Date(s.start_date + "T00:00:00");
  let fyStartYear = start.getMonth() >= 3 ? start.getFullYear() : start.getFullYear() - 1;
  const out: DepYear[] = [];
  let book = s.cost;
  const floor = s.salvage;
  const annualSlm = s.method === "slm" && s.life_years ? (s.cost - s.salvage) / s.life_years : 0;
  for (let i = 0; i < maxYears && book > floor + 0.005; i++) {
    const fyStart = new Date(fyStartYear, 3, 1);
    const fyEnd = new Date(fyStartYear + 1, 2, 31);
    const from = i === 0 ? start : fyStart;
    const fraction = Math.min(1, (fyEnd.getTime() - from.getTime()) / 86400000 / 365 + 1 / 365);
    let charge = s.method === "slm" ? annualSlm * fraction : book * ((s.wdv_rate ?? 0) / 100) * fraction;
    charge = r2(Math.min(charge, book - floor));
    if (s.method === "wdv" && charge < 1) charge = r2(book - floor);
    out.push({ fy: `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`, opening: r2(book), charge, closing: r2(book - charge) });
    book = r2(book - charge);
    fyStartYear++;
  }
  return out;
}

export function currentFy(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
