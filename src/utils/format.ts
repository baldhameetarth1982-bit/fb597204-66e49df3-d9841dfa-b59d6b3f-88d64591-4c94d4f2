import { APP_CONFIG } from "@/config/app";

export function formatCurrency(amount: number, currency = APP_CONFIG.currency) {
  return new Intl.NumberFormat(APP_CONFIG.locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date | string, opts: Intl.DateTimeFormatOptions = {}) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(d);
}
