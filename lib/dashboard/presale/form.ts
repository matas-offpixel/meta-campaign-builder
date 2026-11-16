/**
 * lib/dashboard/presale/form.ts
 *
 * Pure parsing and row-building for the presale log's server actions
 * (lib/actions/presale-log.ts). Nothing here reads the session: the action
 * passes the signed-in user's id and the time, so `entered_by` is never a
 * value the caller sends.
 *
 * A blank field clears the figure and its entered pair together (the
 * migration-249 checks hold a figure and its entered_at set or clear as one).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

export type PresaleLogField = "windowStart" | "soldInWindow" | "avgTicketPrice" | "presaleDayTickets";

export const PRESALE_LOG_FIELD_COLUMN: Record<PresaleLogField, string> = {
  windowStart: "window_start_at",
  soldInWindow: "sold_in_window",
  avgTicketPrice: "avg_ticket_price",
  presaleDayTickets: "presale_day_tickets",
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A whole count: "4,000", "4000", " 4 000 ". Blank = null (clear). */
export function parseCount(raw: string, label: string): Parsed<number | null> {
  const s = raw.replace(/[\s,]/g, "");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false, error: `${label} must be a whole number.` };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > 2_147_483_647) return { ok: false, error: `${label} is too large.` };
  return { ok: true, value: n };
}

/** A price: "£27.50", "27.5", "27". Blank = null. Above 0, two decimals at most. */
export function parsePrice(raw: string): Parsed<number | null> {
  const s = raw.replace(/[\s,£$€]/g, "");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: "The average ticket price must be an amount like 27.50." };
  const n = Number(s);
  if (!(n > 0)) return { ok: false, error: "The average ticket price must be more than 0." };
  if (n >= 100_000_000) return { ok: false, error: "The average ticket price is too large." };
  return { ok: true, value: n };
}

/** A calendar day, YYYY-MM-DD, that exists. */
export function parseDay(raw: string, label: string): Parsed<string> {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: `${label} must be a date.` };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, error: `${label} must be a date.` };
  return { ok: true, value: s };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The window start: an ISO instant with an offset ("2026-08-05T09:30:00Z",
 * "…+01:00"), or a wall-clock time in `timeZone` ("2026-08-05T09:30",
 * "2026-08-05 09:30"), which a datetime-local input sends. Blank = null
 * (back to presale open − 30 min).
 */
export function parseWindowStart(raw: string, timeZone = "Europe/London"): Parsed<string | null> {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  const bad: Parsed<string | null> = { ok: false, error: "The window start must be a date and time." };
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? bad : { ok: true, value: d.toISOString() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return bad;
  const [, y, mo, d, h, mi, se] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  if (Number.isNaN(guess)) return bad;
  // Two passes settle the zone's offset either side of a clock change.
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return { ok: true, value: new Date(instant).toISOString() };
}

/** The update for one presale_logs figure: the value and its entered pair, set or cleared together. */
export function presaleLogFieldUpdate(field: PresaleLogField, raw: string, userId: string, now: string, timeZone = "Europe/London"): Parsed<Record<string, string | number | null>> {
  let parsed: Parsed<string | number | null>;
  switch (field) {
    case "windowStart":
      parsed = parseWindowStart(raw, timeZone);
      break;
    case "soldInWindow":
      parsed = parseCount(raw, "Sold in community window");
      break;
    case "presaleDayTickets":
      parsed = parseCount(raw, "Presale-day tickets");
      break;
    case "avgTicketPrice":
      parsed = parsePrice(raw);
      break;
  }
  if (!parsed.ok) return parsed;
  const column = PRESALE_LOG_FIELD_COLUMN[field];
  const prefix = column.replace(/_at$/, "");
  const clear = parsed.value == null;
  return {
    ok: true,
    value: {
      [column]: parsed.value,
      [`${prefix}_entered_by`]: clear ? null : userId,
      [`${prefix}_entered_at`]: clear ? null : now,
      updated_at: now,
    },
  };
}

/** "What we did" and a result: trimmed, not blank, at most 2,000 characters. */
export function parseNote(raw: string, label: string, allowBlank: boolean): Parsed<string | null> {
  const s = raw.trim();
  if (s === "") return allowBlank ? { ok: true, value: null } : { ok: false, error: `Add ${label}.` };
  if (s.length > 2000) return { ok: false, error: `${label[0]!.toUpperCase()}${label.slice(1)} is too long (2,000 characters at most).` };
  return { ok: true, value: s };
}
