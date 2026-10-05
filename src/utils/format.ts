import { APP_CONFIG } from "@/config/app";
import { localeTag } from "@/lib/i18n";

export function formatCurrency(amount: number, currency = APP_CONFIG.currency) {
  // Money keeps Indian ₹ formatting in every language.
  return new Intl.NumberFormat(APP_CONFIG.locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: Date | string, opts: Intl.DateTimeFormatOptions = {}) {
  const d = typeof date === "string" ? new Date(date) : date;
  // Month names follow the selected app language.
  return new Intl.DateTimeFormat(localeTag(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(d);
}
