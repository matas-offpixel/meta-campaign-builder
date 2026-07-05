/**
 * lib/admin/fans-query.ts — pure logic for the fan data table (OP909
 * Phase 5): query-string → typed filters, a serialisable query PLAN the
 * db layer replays onto the Supabase builder (testable without a client),
 * and CSV generation for the bulk export.
 *
 * Search semantics (PII is encrypted at rest — no SQL LIKE over email or
 * phone):
 *   * contains "@"  → exact-match against email_hash via the salted
 *     hashEmail (same normalisation as the write path, so hashes align).
 *   * anything else → case-insensitive substring over ig_handle /
 *     tt_handle (stored plaintext by design).
 *   * phone search is NOT supported (would require decrypting the whole
 *     table per keystroke) — documented on the UI.
 *
 * Consent semantics: marketing consent (consent_gdpr_at) is REQUIRED at
 * signup, so every canonical row has it — filtering on it is meaningless.
 * The meaningful split is the WhatsApp opt-in (consent_wa_opt_in_at),
 * which is what the consent filter targets. Deviation from the brief's
 * "opted-in/declined" noted in the session log.
 */

export const FANS_PER_PAGE = 50;

/** Hard cap on CSV export rows — keeps the in-memory build bounded. */
export const FANS_EXPORT_MAX_ROWS = 10_000;

export type ConsentFilter = "all" | "wa-opted-in" | "no-wa";

export interface FanFilters {
  /** Filter to one event (the LP dropdown). */
  eventId: string | null;
  /** ISO-2 country from geo_country. */
  country: string | null;
  consent: ConsentFilter;
  /** YYYY-MM-DD inclusive bounds on created_at (UTC days). */
  from: string | null;
  to: string | null;
  /** Raw search text as typed. */
  search: string | null;
  /** 1-based page. */
  page: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;

function one(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = (v ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse Next.js searchParams into validated filters (junk → default). */
export function parseFanFilters(
  searchParams: Record<string, string | string[] | undefined>,
): FanFilters {
  const eventId = one(searchParams.event);
  const country = one(searchParams.country);
  const consentRaw = one(searchParams.consent);
  const from = one(searchParams.from);
  const to = one(searchParams.to);
  const search = one(searchParams.q);
  const pageRaw = Number(one(searchParams.page) ?? "1");

  return {
    eventId: eventId && UUID_RE.test(eventId) ? eventId : null,
    country: country && COUNTRY_RE.test(country) ? country.toUpperCase() : null,
    consent:
      consentRaw === "wa-opted-in" || consentRaw === "no-wa"
        ? consentRaw
        : "all",
    from: from && DAY_RE.test(from) ? from : null,
    to: to && DAY_RE.test(to) ? to : null,
    search: search ? search.slice(0, 100) : null,
    page:
      Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000
        ? pageRaw
        : 1,
  };
}

/** Round-trip filters back to a query string (pagination/export links). */
export function fanFiltersToQueryString(
  filters: FanFilters,
  overrides: Partial<FanFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.eventId) params.set("event", merged.eventId);
  if (merged.country) params.set("country", merged.country);
  if (merged.consent !== "all") params.set("consent", merged.consent);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.search) params.set("q", merged.search);
  if (merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

// ─── Search classification ───────────────────────────────────────────────────

export type SearchTerm =
  | { kind: "email"; normalised: string }
  | { kind: "handle"; normalised: string }
  | { kind: "none" };

/** "@"-bearing input = email (exact via hash); else handle substring. */
export function classifySearch(search: string | null): SearchTerm {
  const value = (search ?? "").trim();
  if (value.length === 0) return { kind: "none" };
  if (value.includes("@") && !value.startsWith("@")) {
    return { kind: "email", normalised: value.toLowerCase() };
  }
  const handle = value.replace(/^@+/, "").toLowerCase();
  if (handle.length === 0) return { kind: "none" };
  return { kind: "handle", normalised: handle };
}

// ─── Query plan ──────────────────────────────────────────────────────────────

/**
 * Serialisable representation of the Supabase filter chain. The db layer
 * replays it mechanically; tests byte-diff the plan without any client.
 */
export type FanQueryOp =
  | { op: "eq"; column: string; value: string }
  | { op: "is"; column: string; value: null }
  | { op: "not"; column: string; operator: "is"; value: null }
  | { op: "gte"; column: string; value: string }
  | { op: "lte"; column: string; value: string }
  | { op: "or"; conditions: string }
  | { op: "order"; column: string; ascending: boolean }
  | { op: "range"; fromIndex: number; toIndex: number };

/** Escape %/_ so a handle search is a literal substring, not a pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Build the filter plan. `hashedEmail` is the salted hash of the search
 * term when classifySearch says email — hashing needs the env salt, so
 * the caller does it (keeps this module env-free).
 *
 * `forExport` swaps pagination for the export row cap.
 */
export function buildFanQueryPlan(
  filters: FanFilters,
  hashedEmail: string | null,
  forExport = false,
): FanQueryOp[] {
  const ops: FanQueryOp[] = [
    // Canonical rows only: repeats are attribution-only (no PII) and
    // would render as blank duplicate lines.
    { op: "is", column: "deduplicated_signup_id", value: null },
    { op: "is", column: "deleted_at", value: null },
  ];

  if (filters.eventId) {
    ops.push({ op: "eq", column: "event_id", value: filters.eventId });
  }
  if (filters.country) {
    ops.push({ op: "eq", column: "geo_country", value: filters.country });
  }
  if (filters.consent === "wa-opted-in") {
    ops.push({ op: "not", column: "consent_wa_opt_in_at", operator: "is", value: null });
  } else if (filters.consent === "no-wa") {
    ops.push({ op: "is", column: "consent_wa_opt_in_at", value: null });
  }
  if (filters.from) {
    ops.push({ op: "gte", column: "created_at", value: `${filters.from}T00:00:00Z` });
  }
  if (filters.to) {
    ops.push({ op: "lte", column: "created_at", value: `${filters.to}T23:59:59.999Z` });
  }

  const term = classifySearch(filters.search);
  if (term.kind === "email" && hashedEmail) {
    ops.push({ op: "eq", column: "email_hash", value: hashedEmail });
  } else if (term.kind === "handle") {
    const pattern = `%${escapeLike(term.normalised)}%`;
    ops.push({
      op: "or",
      conditions: `ig_handle.ilike.${pattern},tt_handle.ilike.${pattern}`,
    });
  }

  ops.push({ op: "order", column: "created_at", ascending: false });
  if (forExport) {
    ops.push({ op: "range", fromIndex: 0, toIndex: FANS_EXPORT_MAX_ROWS - 1 });
  } else {
    const offset = (filters.page - 1) * FANS_PER_PAGE;
    ops.push({ op: "range", fromIndex: offset, toIndex: offset + FANS_PER_PAGE - 1 });
  }
  return ops;
}

// ─── CSV export ──────────────────────────────────────────────────────────────

export interface FanCsvRow {
  email: string | null;
  phone: string | null;
  ig: string | null;
  tt: string | null;
  country: string | null;
  region: string | null;
  marketingConsentAt: string | null;
  waOptInAt: string | null;
  signupAt: string;
  pageSlug: string;
  pageTitle: string;
}

export const FAN_CSV_HEADER = [
  "email",
  "phone",
  "ig",
  "tt",
  "country",
  "region",
  "consent",
  "wa_opt_in",
  "signup_at",
  "page_slug",
  "page_title",
] as const;

/**
 * RFC-4180 escaping + spreadsheet formula-injection guard (a leading
 * = + - @ gets a ' prefix so Excel/Sheets render it as text).
 */
export function csvField(value: string | null): string {
  if (value === null || value.length === 0) return "";
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function buildFansCsv(rows: FanCsvRow[]): string {
  const lines = [FAN_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.email),
        csvField(row.phone),
        csvField(row.ig),
        csvField(row.tt),
        csvField(row.country),
        csvField(row.region),
        row.marketingConsentAt ? "yes" : "no",
        row.waOptInAt ? "yes" : "no",
        csvField(row.signupAt),
        csvField(row.pageSlug),
        csvField(row.pageTitle),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** {client-slug}-fans-{yyyy-mm-dd}.csv (UTC date). */
export function fansCsvFilename(clientSlug: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `${clientSlug}-fans-${day}.csv`;
}
