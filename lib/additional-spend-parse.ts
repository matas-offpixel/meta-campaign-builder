/**
 * Shared parsing for additional spend amount + date fields (dashboard +
 * share token routes + `AdditionalSpendCard`). Keeps UI and API aligned
 * on UK-friendly money strings and DD/MM/YYYY alongside ISO dates.
 */

export type ParseFail = { ok: false; message: string };
export type ParseAmountOk = { ok: true; value: number };
export type ParseDateOk = { ok: true; isoDate: string };

/** User-facing copy when amount cannot be parsed. */
export const AMOUNT_PARSE_HINT =
  "Enter a number — decimals ok, no commas or £ symbols.";

function isValidCalendarIso(iso: string): boolean {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return false;
  }
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Normalises typed money: strips £/€/spaces, removes thousands commas,
 * then parseFloat. Rejects NaN and negatives.
 */
export function parseMoneyAmountInput(raw: unknown): ParseAmountOk | ParseFail {
  if (raw === null || raw === undefined) {
    return { ok: false, message: AMOUNT_PARSE_HINT };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, message: "Amount must be a positive number." };
    }
    return { ok: true, value: Math.round(raw * 100) / 100 };
  }
  if (typeof raw !== "string") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: AMOUNT_PARSE_HINT };
    }
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: AMOUNT_PARSE_HINT };
  }

  const cleaned = trimmed
    .replace(/[£€]/g, "")
    .replace(/\s/g, "")
    .replace(/,/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: AMOUNT_PARSE_HINT };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * Accepts `YYYY-MM-DD` (from `<input type="date">`) or UK-style
 * `DD/MM/YYYY` / `DD-MM-YYYY`.
 */
export function parseSpendDateToIso(raw: unknown): ParseDateOk | ParseFail {
  if (raw == null || typeof raw !== "string") {
    return { ok: false, message: "Enter a valid date." };
  }
  const s = raw.trim();
  if (!s) {
    return { ok: false, message: "Enter a valid date." };
  }

  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/;
  const isoM = s.match(isoDay);
  if (isoM) {
    const iso = `${isoM[1]}-${isoM[2]}-${isoM[3]}`;
    if (!isValidCalendarIso(iso)) {
      return { ok: false, message: "Enter a valid date." };
    }
    return { ok: true, isoDate: iso };
  }

  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
  const m = s.match(uk);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (
      !Number.isFinite(dd) ||
      !Number.isFinite(mm) ||
      !Number.isFinite(yyyy) ||
      dd < 1 ||
      dd > 31 ||
      mm < 1 ||
      mm > 12
    ) {
      return { ok: false, message: "Enter a valid date." };
    }
    const iso = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (!isValidCalendarIso(iso)) {
      return { ok: false, message: "Enter a valid date." };
    }
    return { ok: true, isoDate: iso };
  }

  return {
    ok: false,
    message: "Use YYYY-MM-DD or DD/MM/YYYY (e.g. 15/04/2026).",
  };
}

/** Dev-only: log invalid payloads without leaking in production. */
export function logAdditionalSpendValidationFailure(
  scope: string,
  body: unknown,
  extra?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV !== "development") return;
  console.warn(`[additional-spend] validation failed: ${scope}`, {
    body,
    ...extra,
  });
}
