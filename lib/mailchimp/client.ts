const MAX_ATTEMPTS = 3;
const TRANSIENT_BACKOFFS_MS = [750, 2_000];

export class MailchimpApiError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "MailchimpApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Derives the Mailchimp data-centre suffix from an API key.
 * Mailchimp keys end with `-us21`, `-us6`, etc.
 */
export function extractDc(apiKey: string): string {
  const dc = apiKey.split("-").at(-1);
  if (!dc || dc === apiKey) {
    throw new MailchimpApiError(
      "Cannot derive data centre from Mailchimp API key. Expected format: <key>-<dc>.",
    );
  }
  return dc;
}

function mailchimpBase(dc: string): string {
  return `https://${dc}.api.mailchimp.com/3.0`;
}

/** Basic-auth header. Username is arbitrary per Mailchimp docs. */
function basicAuthHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");
}

async function mailchimpGet<T>(
  dc: string,
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<T> {
  const url = new URL(
    path.replace(/^\//, ""),
    `${mailchimpBase(dc)}/`,
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError: MailchimpApiError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: basicAuthHeader(apiKey),
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
    } catch (err) {
      lastError = new MailchimpApiError(
        `Network error calling Mailchimp API: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (attempt >= MAX_ATTEMPTS - 1) throw lastError;
      await sleep(TRANSIENT_BACKOFFS_MS[attempt] ?? 2_000);
      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    const detail =
      typeof raw.detail === "string"
        ? raw.detail
        : typeof raw.title === "string"
          ? raw.title
          : `HTTP ${response.status}`;

    lastError = new MailchimpApiError(detail, response.status, detail);

    if (response.status >= 500 && response.status <= 599) {
      if (attempt < MAX_ATTEMPTS - 1) {
        console.warn(
          `[mailchimpGet] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${TRANSIENT_BACKOFFS_MS[attempt]}ms: ${path}`,
        );
        await sleep(TRANSIENT_BACKOFFS_MS[attempt] ?? 2_000);
        continue;
      }
    }

    throw lastError;
  }

  throw lastError ?? new MailchimpApiError("Mailchimp API request failed.");
}

// ── Public functions ──────────────────────────────────────────────────────────

export interface MailchimpPingResponse {
  health_status: string;
}

/** Validates credentials by calling /ping. Throws MailchimpApiError on failure. */
export async function pingMailchimp(
  dc: string,
  apiKey: string,
): Promise<MailchimpPingResponse> {
  return mailchimpGet<MailchimpPingResponse>(dc, "/ping", {}, apiKey);
}

export interface MailchimpListStats {
  member_count: number;
  unsubscribe_count: number;
  cleaned_count: number;
  member_count_since_send: number;
  unsubscribe_count_since_send: number;
  cleaned_count_since_send: number;
  campaign_count: number;
  campaign_last_sent: string;
  merge_field_count: number;
  avg_sub_rate: number;
  avg_unsub_rate: number;
  target_sub_rate: number;
  open_rate: number;
  click_rate: number;
  last_sub_date: string;
  last_unsub_date: string;
}

export interface MailchimpAudience {
  id: string;
  web_id: number;
  name: string;
  contact: {
    company: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  stats: MailchimpListStats;
  date_created: string;
}

/** Fetches stats for a single audience/list. */
export async function getAudience(
  dc: string,
  audienceId: string,
  apiKey: string,
): Promise<MailchimpAudience> {
  return mailchimpGet<MailchimpAudience>(
    dc,
    `/lists/${audienceId}`,
    { fields: "id,name,stats,date_created" },
    apiKey,
  );
}

export interface MailchimpGrowthHistoryEntry {
  month: string;
  existing: number;
  imports: number;
  optins: number;
  pending: number;
  unsubscribes: number;
}

export interface MailchimpGrowthHistoryResponse {
  history: MailchimpGrowthHistoryEntry[];
  list_id: string;
  total_items: number;
}

/** Fetches monthly growth history for an audience. */
export async function getAudienceGrowthHistory(
  dc: string,
  audienceId: string,
  apiKey: string,
): Promise<MailchimpGrowthHistoryResponse> {
  return mailchimpGet<MailchimpGrowthHistoryResponse>(
    dc,
    `/lists/${audienceId}/growth-history`,
    { fields: "history.month,history.existing,history.imports,history.optins,history.pending,history.unsubscribes,list_id,total_items", count: "60" },
    apiKey,
  );
}

export interface MailchimpListsResponse {
  lists: Array<{ id: string; name: string; stats: MailchimpListStats }>;
  total_items: number;
}

/** Lists all audiences for the account. */
export async function listAudiences(
  dc: string,
  apiKey: string,
): Promise<MailchimpListsResponse> {
  return mailchimpGet<MailchimpListsResponse>(
    dc,
    "/lists",
    { fields: "lists.id,lists.name,lists.stats", count: "200" },
    apiKey,
  );
}

/**
 * One entry from the Mailchimp per-day audience activity endpoint.
 * `subs` / `unsubs` / `other_adds` / `other_removes` are daily DELTAS.
 * The cumulative total must be reconstructed by anchoring to the live
 * `member_count` from `getAudience()` and walking backwards.
 */
export interface MailchimpActivityRow {
  day: string;           // YYYY-MM-DD
  emails_sent: number;
  unique_opens: number;
  recipient_clicks: number;
  hard_bounce: number;
  soft_bounce: number;
  subs: number;          // new subscriptions that day
  unsubs: number;        // unsubscribes that day
  other_adds: number;    // admin-added or imported
  other_removes: number; // admin-removed or cleaned
}

export interface MailchimpListActivityResponse {
  activity: MailchimpActivityRow[];
  list_id: string;
  total_items: number;
}

/**
 * Fetches per-day subscriber activity for an audience.
 * Returns up to `count` days of activity (Mailchimp max is 180).
 *
 * IMPORTANT: each row contains DAILY DELTAS (subs, unsubs), not
 * cumulative totals. Call `getAudience()` for the live total and walk
 * backwards through the activity array to reconstruct daily cumulatives.
 */
export async function getAudienceListActivity(
  apiKey: string,
  dc: string,
  listId: string,
  count: number,
): Promise<MailchimpActivityRow[]> {
  const res = await mailchimpGet<MailchimpListActivityResponse>(
    dc,
    `/lists/${listId}/activity`,
    { count: String(Math.min(count, 180)) },
    apiKey,
  );
  return res.activity ?? [];
}

/**
 * One segment/tag entry from the Mailchimp segments endpoint.
 * Tags created via the Mailchimp UI appear as type === "static" segments.
 */
export interface MailchimpSegment {
  id: number;
  name: string;
  type: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface MailchimpSegmentsResponse {
  segments: MailchimpSegment[];
  list_id: string;
  total_items: number;
}

/**
 * Lists all segments for an audience, optionally filtered by type.
 * Mailchimp tags created in the UI appear as type="static" segments.
 * Pass `type: "static"` to limit to tags only.
 */
export async function getAudienceSegments(
  dc: string,
  audienceId: string,
  apiKey: string,
  options: { type?: "static" | "saved" | "fuzzy"; count?: number } = {},
): Promise<MailchimpSegmentsResponse> {
  const params: Record<string, string> = {
    count: String(options.count ?? 1000),
  };
  if (options.type) {
    params.type = options.type;
  }
  return mailchimpGet<MailchimpSegmentsResponse>(
    dc,
    `/lists/${audienceId}/segments`,
    params,
    apiKey,
  );
}

/** Returns the account info (used to derive loginId at connect time). */
export async function getAccountInfo(
  dc: string,
  apiKey: string,
): Promise<{ account_id: string; account_name: string; login_id: string }> {
  return mailchimpGet<{
    account_id: string;
    account_name: string;
    login_id: string;
  }>(dc, "/", {}, apiKey);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
