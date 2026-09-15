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
  onsale_at: string | null;
  presale_at: string | null;
}

export interface CirqlinDailyRow {
  /** Calendar day in Europe/London, YYYY-MM-DD. */
  day: string;
  /** Form submissions that day, spam excluded. */
  signups: number;
}

export interface CirqlinSyncBucket {
  synced: number;
  failed: number;
  skipped: number;
}

export interface CirqlinSignupsPayload {
  ok: true;
  tag: string;
  page: CirqlinPage;
  totals: {
    signups: number;
    spam_flagged: number;
    /** signups − spam_flagged — the Insights page's shown count. */
    counted: number;
  };
  daily: CirqlinDailyRow[];
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
