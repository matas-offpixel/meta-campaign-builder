/**
 * lib/ticketing/parse-ticketing-xlsx.ts
 *
 * Parse "weekly ticket tracker" xlsx exports into a flat snapshot list the
 * importer can reconcile against `events`. Targets the 4theFans TICKETING
 * format but stays tolerant of the J2 Bridge variant observed in-repo
 * because both follow the same shape:
 *
 *   Row 0 (event header): [label..., label..., EVENT_A, null, EVENT_B, null, ...]
 *   Row 1 (metric header): [null..., null..., "Total", "Increase", ...]
 *   Row 2..N (weekly data): [annotation?, week_label, totalA, deltaA, totalB, deltaB, ...]
 *
 * The "metric header" can have up to 3 columns per event (Total + Increase
 * + CPT Change per the brief); this parser drops CPT because the schema
 * has no column for it and the chart computes CPT on the fly from
 * `ad_spend` + `tickets_sold`.
 *
 * The week column is recognised by parsing the cell text into a Date. We
 * accept:
 *
 *   - "23rd Feb"                → 2026-02-23 (year inferred from "today")
 *   - "23rd Feb 2026"           → 2026-02-23
 *   - "23/02/2026" / "2026-02-23" → literal
 *   - "W/C 23rd Feb"            → 2026-02-23 (operator-added prefix)
 *
 * Anything unparseable routes into `unparsedWeeks` so the operator sees it
 * in the preview and can hand-edit the sheet.
 *
 * Output shape is intentionally narrow — the importer decides how to
 * match event names against the `events` table and how to upsert.
 */

import * as XLSX from "xlsx";

/**
 * One cumulative ticket-sold datapoint extracted from the xlsx. The
 * importer joins `eventLabel` against `events.name` (exact, then
 * fuzzy) and collapses multiple tabs of the same event to the latest
 * `ticketsSold` value per `(eventId, snapshotAt)`.
 */
export interface ParsedSnapshot {
  /** Display name from the sheet header — used by the matcher to find
   *  the `events` row. NOT used as a database key on its own. */
  eventLabel: string;
  /** ISO date string (YYYY-MM-DD) of the week-ending snapshot. */
  snapshotAt: string;
  /** Cumulative tickets sold as of that week. `null` when the cell was
   *  blank — the importer skips these to avoid clobbering real values
   *  with sentinel zeros. */
  ticketsSold: number | null;
  /** Week-over-week increase (optional; sheet carries it but we don't
   *  persist it — derivable from diffs of the cumulative series). Kept
   *  in the output for the preview UI. */
  weeklyIncrease: number | null;
  /** Which sheet the row came from — useful when the same event
   *  appears across multiple tabs and the operator needs to audit. */
  sheetName: string;
}

export interface ParseError {
  sheetName: string;
  row: number;
  column: number | null;
  kind:
    | "unparseable_date"
    | "non_numeric_tickets"
    | "missing_event_label"
    | "missing_metric_header"
    | "empty_sheet";
  raw: string | null;
  message: string;
}

export interface ParseResult {
  snapshots: ParsedSnapshot[];
  errors: ParseError[];
  /** Sheet-by-sheet breakdown — surfaced in the preview UI so the
   *  operator knows which tab contributed what. */
  sheets: Array<{
    name: string;
    eventsDetected: string[];
    weeksDetected: string[];
    snapshotCount: number;
  }>;
}

/**
 * Entry point. Consumes a workbook (buffer or parsed `XLSX.WorkBook`)
 * and returns every snapshot we could reconcile plus structured
 * errors. Never throws on malformed input — the importer relies on
 * being able to show the errors in the preview so the operator can
 * fix the sheet and re-try.
 */
export function parseTicketingWorkbook(
  source: Buffer | ArrayBuffer | XLSX.WorkBook,
  opts?: { referenceYear?: number },
): ParseResult {
  const workbook: XLSX.WorkBook =
    typeof (source as XLSX.WorkBook).SheetNames !== "undefined"
      ? (source as XLSX.WorkBook)
      : XLSX.read(source as Buffer | ArrayBuffer, { type: "buffer" });

  const snapshots: ParsedSnapshot[] = [];
  const errors: ParseError[] = [];
  const sheetSummaries: ParseResult["sheets"] = [];
  const referenceYear = opts?.referenceYear ?? new Date().getUTCFullYear();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // `raw: false` so numeric dates get formatted strings, saving
    // us a second branch in the date parser. `defval: null` keeps
    // empty cells as null instead of undefined — cleaner indexing.
    const rows = XLSX.utils.sheet_to_json<Array<string | null>>(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    const parsed = parseSheet(rows, sheetName, referenceYear);
    snapshots.push(...parsed.snapshots);
    errors.push(...parsed.errors);
    sheetSummaries.push({
      name: sheetName,
      eventsDetected: parsed.eventsDetected,
      weeksDetected: parsed.weeksDetected,
      snapshotCount: parsed.snapshots.length,
    });
  }

  return { snapshots, errors, sheets: sheetSummaries };
}

interface SheetParseResult {
  snapshots: ParsedSnapshot[];
  errors: ParseError[];
  eventsDetected: string[];
  weeksDetected: string[];
}

function parseSheet(
  rows: Array<Array<string | null>>,
  sheetName: string,
  referenceYear: number,
): SheetParseResult {
  const out: SheetParseResult = {
    snapshots: [],
    errors: [],
    eventsDetected: [],
    weeksDetected: [],
  };

  if (rows.length < 3) {
    out.errors.push({
      sheetName,
      row: 0,
      column: null,
      kind: "empty_sheet",
      raw: null,
      message: "Sheet has fewer than three rows; nothing to parse.",
    });
    return out;
  }

  // Event-name row + metric row. Metric row typically on index 1 but
  // operators sometimes insert a blank spacer row between them — look
  // up to row 3 for a row whose non-null cells are dominated by
  // "Total" / "Increase" / "CPT".
  const eventHeader = rows[0];
  const metricHeader = findMetricHeader(rows);
  if (!metricHeader) {
    out.errors.push({
      sheetName,
      row: 1,
      column: null,
      kind: "missing_metric_header",
      raw: null,
      message:
        'Could not find a "Total / Increase" metric header in the first three rows.',
    });
    return out;
  }

  // Scan metric header to discover event column groups. Each event
  // owns a contiguous run of 1..3 columns starting at the column
  // whose metric cell says "Total" (case-insensitive, trimmed).
  const eventColumns: Array<{
    label: string;
    totalCol: number;
    increaseCol: number | null;
  }> = [];
  for (let c = 0; c < metricHeader.row.length; c++) {
    if (!isTotalCell(metricHeader.row[c])) continue;
    const label = (eventHeader[c] ?? "").toString().trim();
    if (!label) {
      out.errors.push({
        sheetName,
        row: 0,
        column: c,
        kind: "missing_event_label",
        raw: null,
        message: `Column ${columnLetter(c)} has a "Total" metric header but no event label.`,
      });
      continue;
    }
    const increaseCol = isIncreaseCell(metricHeader.row[c + 1])
      ? c + 1
      : null;
    eventColumns.push({ label, totalCol: c, increaseCol });
  }
  out.eventsDetected = eventColumns.map((e) => e.label);

  if (eventColumns.length === 0) {
    return out;
  }

  // First data row is the one after the metric header. Find the
  // column that carries the week date — prefer the column headed
  // "W/C" or "Week Commencing"; fall back to the leftmost column
  // whose first-row cell parses as a date.
  const weekCol = findWeekColumn(eventHeader, rows, metricHeader.rowIndex);
  if (weekCol === null) {
    out.errors.push({
      sheetName,
      row: metricHeader.rowIndex + 1,
      column: null,
      kind: "unparseable_date",
      raw: null,
      message: "Could not locate a week column; expected one whose values parse as dates.",
    });
    return out;
  }

  for (let r = metricHeader.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const rawWeek = row[weekCol];
    if (rawWeek == null || String(rawWeek).trim() === "") continue;
    const snapshotAt = parseWeekLabel(String(rawWeek), referenceYear);
    if (!snapshotAt) {
      out.errors.push({
        sheetName,
        row: r,
        column: weekCol,
        kind: "unparseable_date",
        raw: String(rawWeek),
        message: `Could not parse week label "${rawWeek}" into a date.`,
      });
      continue;
    }
    if (!out.weeksDetected.includes(snapshotAt)) {
      out.weeksDetected.push(snapshotAt);
    }
    for (const ev of eventColumns) {
      const totalCell = row[ev.totalCol];
      if (totalCell == null || String(totalCell).trim() === "") continue;
      const total = parseIntegerCell(totalCell);
      if (total === null) {
        out.errors.push({
          sheetName,
          row: r,
          column: ev.totalCol,
          kind: "non_numeric_tickets",
          raw: String(totalCell),
          message: `Non-numeric cumulative-tickets cell for ${ev.label}.`,
        });
        continue;
      }
      const increase =
        ev.increaseCol != null
          ? parseIntegerCell(row[ev.increaseCol])
          : null;
      out.snapshots.push({
        eventLabel: ev.label,
        snapshotAt,
        ticketsSold: total,
        weeklyIncrease: increase,
        sheetName,
      });
    }
  }

  return out;
}

function findMetricHeader(
  rows: Array<Array<string | null>>,
): { rowIndex: number; row: Array<string | null> } | null {
  // Scan the first three rows. Accept the first row whose populated
  // cells are >=50% "Total"/"Increase"/"CPT" tokens. A single "Total"
  // cell still counts — solo-event sheets (one show, one column) are
  // valid inputs and operators shouldn't have to pad synthetic
  // columns just to trip the quorum.
  for (let i = 1; i <= Math.min(2, rows.length - 1); i++) {
    const row = rows[i];
    const populated = row.filter((c) => c != null && String(c).trim() !== "");
    if (populated.length === 0) continue;
    const metrics = populated.filter((c) =>
      /^(total|increase|cpt|cpt change|change|ticket sold change)$/i.test(
        String(c).trim(),
      ),
    );
    if (metrics.length / populated.length >= 0.5) {
      return { rowIndex: i, row };
    }
  }
  return null;
}

function findWeekColumn(
  eventHeader: Array<string | null>,
  rows: Array<Array<string | null>>,
  metricRow: number,
): number | null {
  // Preferred: a header cell whose text matches W/C or Week Commencing.
  for (let c = 0; c < eventHeader.length; c++) {
    const v = eventHeader[c];
    if (!v) continue;
    if (/^(w\/c|w c|week commencing|week)$/i.test(String(v).trim())) return c;
  }
  // Fallback: leftmost column whose first data row parses as a date.
  if (metricRow + 1 < rows.length) {
    const firstData = rows[metricRow + 1];
    for (let c = 0; c < firstData.length; c++) {
      const v = firstData[c];
      if (!v) continue;
      if (parseWeekLabel(String(v), new Date().getUTCFullYear()) != null) {
        return c;
      }
    }
  }
  return null;
}

function isTotalCell(v: string | null | undefined): boolean {
  return typeof v === "string" && /^\s*total\s*$/i.test(v);
}

function isIncreaseCell(v: string | null | undefined): boolean {
  return typeof v === "string" && /^\s*(increase|ticket sold change)\s*$/i.test(v);
}

/**
 * Accept the surprisingly varied forms operators type into the week
 * column. Returns ISO YYYY-MM-DD or null.
 *
 * Supported inputs:
 *   "23rd Feb"           → <referenceYear>-02-23
 *   "23 Feb"             → <referenceYear>-02-23
 *   "23rd February 2026" → 2026-02-23
 *   "2 March"            → <referenceYear>-03-02
 *   "W/C 23rd Feb"       → <referenceYear>-02-23
 *   "2026-02-23"         → 2026-02-23
 *   "23/02/2026"         → 2026-02-23
 */
export function parseWeekLabel(
  input: string,
  referenceYear: number,
): string | null {
  const s = String(input).trim().replace(/^w\/c\s+/i, "").trim();
  if (!s) return null;

  // ISO first — cheapest to recognise.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d}`;
  }

  // dd/mm/yyyy — UK-formatted which is dominant for the 4theFans team.
  // Using a date-only regex so timezone offsets don't creep in.
  const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (uk) {
    const [, d, m, yRaw] = uk;
    const y =
      yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
    return iso8601(y, parseInt(m, 10), parseInt(d, 10));
  }

  // "23rd Feb" / "23 Feb" / "23rd February 2026".
  const named = s.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:[,\s]+(\d{2,4}))?$/,
  );
  if (named) {
    const [, dRaw, monthRaw, yRaw] = named;
    const month = monthLookup(monthRaw);
    if (month === null) return null;
    const year = yRaw
      ? yRaw.length === 2
        ? 2000 + parseInt(yRaw, 10)
        : parseInt(yRaw, 10)
      : referenceYear;
    return iso8601(year, month, parseInt(dRaw, 10));
  }

  return null;
}

function monthLookup(raw: string): number | null {
  const key = raw.slice(0, 3).toLowerCase();
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return months[key] ?? null;
}

function iso8601(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseIntegerCell(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  // Operators use comma thousand-separators and trailing stars/notes
  // ("1,035*" means "estimated"). Strip anything non-digit before
  // parsing. Cells that strip to empty (pure text like "abc") return
  // null rather than `Number("")`'s 0, so the caller can flag them
  // as non-numeric errors instead of silently logging a zero-ticket
  // snapshot.
  const cleaned = s.replace(/[^\d-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function columnLetter(c: number): string {
  let s = "";
  let n = c;
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}
