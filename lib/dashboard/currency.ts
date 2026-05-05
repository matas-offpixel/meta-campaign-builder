/**
 * lib/dashboard/currency.ts
 *
 * Currency safety helper for the multi-channel ticketing surfaces.
 * `events.currency` and `clients.default_currency` aren't columns in
 * the schema today (June 2026). The data layer therefore defaults to
 * GBP for every read, with hooks to thread an explicit code through
 * once a future migration adds those fields. For 4thefans (the only
 * client wired to this surface) every tier price is in GBP — the
 * default produces the correct symbol on every revenue display.
 *
 * Single source of truth so we don't sprinkle `new Intl.NumberFormat`
 * calls across components — when we do add a column, we flip one
 * constant here and every revenue cell updates.
 */

export type CurrencyCode = "GBP" | "EUR" | "USD";

const DEFAULT_CURRENCY: CurrencyCode = "GBP";

export function resolveCurrency(
  eventCurrency?: string | null,
  clientDefaultCurrency?: string | null,
): CurrencyCode {
  const candidates = [eventCurrency, clientDefaultCurrency];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const upper = value.trim().toUpperCase();
    if (upper === "GBP" || upper === "EUR" || upper === "USD") return upper;
  }
  return DEFAULT_CURRENCY;
}

export function currencySymbol(currency: CurrencyCode): string {
  switch (currency) {
    case "GBP":
      return "£";
    case "EUR":
      return "€";
    case "USD":
      return "$";
  }
}

export function formatCurrency(
  value: number | null | undefined,
  options?: { currency?: CurrencyCode; dp?: 0 | 2 },
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const currency = options?.currency ?? DEFAULT_CURRENCY;
  const dp = options?.dp ?? 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value);
}

/**
 * Auto-compute revenue from price × tickets_sold. Returns null when
 * either input is missing — the caller is expected to fall back to
 * an explicit override in that case.
 */
export function autoComputeRevenue(
  price: number | null | undefined,
  ticketsSold: number | null | undefined,
): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  if (ticketsSold == null || !Number.isFinite(ticketsSold)) return null;
  return Math.round(price * ticketsSold * 100) / 100;
}
