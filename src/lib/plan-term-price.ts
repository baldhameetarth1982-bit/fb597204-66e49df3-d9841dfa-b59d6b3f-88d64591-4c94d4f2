// Display-only mirror of the server quote (saas_upi_quote): term price per flat
// rounded to whole rupees after the term discount. The server stays authoritative.
export const TERM_DISCOUNT_PCT: Record<1 | 3 | 12, number> = { 1: 0, 3: 6, 12: 8 };

export function termPricePerFlat(monthly: number, months: 1 | 3 | 12) {
  return Math.round((monthly * months * (100 - TERM_DISCOUNT_PCT[months])) / 100);
}

export function termFullPricePerFlat(monthly: number, months: 1 | 3 | 12) {
  return monthly * months;
}
