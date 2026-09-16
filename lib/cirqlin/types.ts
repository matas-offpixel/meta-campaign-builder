/**
 * lib/cirqlin/types.ts
 *
 * The partner-read payload from Cirqlin
 * (`GET /api/partner/signups?tag=`). Counts only — no PII crosses
 * the boundary. The join key is Cirqlin `pages.crm_base_tag` ↔
 * `events.mailchimp_tag`.
 */

export interface CirqlinPage {
  id: string;
  slug: string;
  title: string;
  event_date: string | null;
  onsale_at: string | null;
  presale_at: string | null;
  timezone: string | null;
}

export interface CirqlinDailyRow {
  /** Calendar day in `daily_timezone`, YYYY-MM-DD. Not always London. */
  day: string;
  /** Form submissions that day, spam excluded. */
  signups: number;
}

export interface CirqlinSyncBucket {
  synced: number;
  failed: number;
  skipped: number;
}

/**
 * The live route's body. `isCirqlinSignupsPayload` is the minimum
 * structural gate, not a full check of this shape — anything below it
 * does not verify (`multiple`, `daily_timezone`, `sync`, `capturedAt`)
 * is defended where it is read.
 */
export interface CirqlinSignupsPayload {
  ok: true;
  tag: string;
  /** Every page carrying the tag. `totals` already sums across them. */
  pages: CirqlinPage[];
  /** True when the tag spans more than one page — we map one tag to one event. */
  multiple: boolean;
  totals: {
    signups: number;
    spam_flagged: number;
    /** signups − spam_flagged — the Insights page's shown count. */
    counted: number;
  };
  daily: CirqlinDailyRow[];
  /** IANA zone Cirqlin bucketed `daily[]` by — the page's own, or its default. */
  daily_timezone: string;
  sync: {
    mailchimp: CirqlinSyncBucket;
    bird: CirqlinSyncBucket;
  };
  capturedAt: string;
}

export type CirqlinFetchFailureReason =
  | "not_configured"
  | "unauthorized"
  | "no_page"
  | "error";

export type CirqlinFetchResult =
  | { ok: true; payload: CirqlinSignupsPayload }
  | {
      ok: false;
      reason: CirqlinFetchFailureReason;
      status?: number;
      message?: string;
    };

/** One persisted day in `signup_source_snapshots`. */
export interface CirqlinSnapshotRow {
  day: string;
  signups_day: number;
  signups_total: number;
  snapshot_at: string;
  raw_json: Record<string, unknown> | null;
}
