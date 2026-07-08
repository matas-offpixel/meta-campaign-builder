/**
 * lib/d2c/metrics/types.ts
 *
 * Per-send delivery + engagement metrics (Goal 4). Stored on
 * `d2c_scheduled_sends.result_jsonb.metrics` — no new table. Pure module
 * (no server-only imports) so the readers are unit-testable under `node --test`.
 */

export interface MetricRate {
  unique: number;
  total: number;
  /** 0..1 fraction (Mailchimp open_rate / click_rate). */
  rate: number;
}

export interface D2CSendMetrics {
  fetched_at: string;
  provider: "mailchimp" | "bird";
  /** Successfully delivered / dispatched. */
  delivered: number;
  /** Total attempted (Mailchimp emails_sent / Bird counters.campaign.total). */
  attempted: number;
  /** Email engagement — null for Bird (WhatsApp broadcast API has no opens). */
  opens: MetricRate | null;
  clicks: MetricRate | null;
  bounces: number | null;
  unsubscribes: number | null;
  /** Full provider response, kept verbatim for future-proofing. */
  raw: unknown;
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * One-line human summary of a metrics blob for the preview card. Email shows
 * opens + clicks; Bird (WhatsApp) has no engagement so shows delivery only.
 * Pure.
 */
export function formatMetricsSummary(metrics: D2CSendMetrics): string {
  const parts: string[] = [
    `Delivered ${metrics.delivered.toLocaleString()} of ${metrics.attempted.toLocaleString()}`,
  ];
  if (metrics.opens) {
    parts.push(`Opens ${metrics.opens.unique.toLocaleString()} (${pct(metrics.opens.rate)})`);
  }
  if (metrics.clicks) {
    parts.push(`Clicks ${metrics.clicks.unique.toLocaleString()} (${pct(metrics.clicks.rate)})`);
  }
  if (metrics.bounces != null && metrics.bounces > 0) {
    parts.push(`Bounces ${metrics.bounces.toLocaleString()}`);
  }
  return parts.join(" · ");
}

/** result_jsonb shape we care about (everything else is provider free-form). */
interface ResultJsonbWithMetrics {
  metrics?: unknown;
  meta?: { mailchimp_campaign_id?: unknown; server_prefix?: unknown };
  details?: {
    campaign?: { id?: unknown; long_archive_url?: unknown } | null;
    id?: unknown;
  } | null;
  providerJobId?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Read a persisted metrics blob back off result_jsonb, or null. */
export function readSendMetrics(resultJsonb: unknown): D2CSendMetrics | null {
  const root = asRecord(resultJsonb) as ResultJsonbWithMetrics | null;
  const m = asRecord(root?.metrics);
  if (!m) return null;
  if (typeof m.provider !== "string" || typeof m.fetched_at !== "string") return null;
  return m as unknown as D2CSendMetrics;
}

/**
 * Extract the Mailchimp campaign id from a send's result_jsonb, checking (in
 * order): explicit meta.mailchimp_campaign_id, details.campaign.id, top-level
 * providerJobId. The Mailchimp provider stores `{ id }` in details.campaign.
 */
export function readMailchimpCampaignId(resultJsonb: unknown): string | null {
  const root = asRecord(resultJsonb) as ResultJsonbWithMetrics | null;
  if (!root) return null;
  const meta = root.meta;
  if (meta && typeof meta.mailchimp_campaign_id === "string" && meta.mailchimp_campaign_id.trim()) {
    return meta.mailchimp_campaign_id.trim();
  }
  const campaign = asRecord(root.details?.campaign);
  if (campaign && typeof campaign.id === "string" && campaign.id.trim()) {
    return campaign.id.trim();
  }
  if (typeof root.providerJobId === "string" && root.providerJobId.trim()) {
    return root.providerJobId.trim();
  }
  return null;
}

/**
 * Derive a Mailchimp server prefix (DC) from a stored long_archive_url like
 * `https://us7.campaign-archive.com/?u=…&id=…` → "us7". Returns null when no
 * archive url is present.
 */
export function readMailchimpServerPrefix(resultJsonb: unknown): string | null {
  const root = asRecord(resultJsonb) as ResultJsonbWithMetrics | null;
  const meta = root?.meta;
  if (meta && typeof meta.server_prefix === "string" && meta.server_prefix.trim()) {
    return meta.server_prefix.trim();
  }
  const campaign = asRecord(root?.details?.campaign);
  const archive = campaign && typeof campaign.long_archive_url === "string"
    ? campaign.long_archive_url
    : null;
  if (!archive) return null;
  const m = /^https?:\/\/([a-z]+\d+)\.campaign-archive\.com/i.exec(archive);
  return m ? m[1]! : null;
}
