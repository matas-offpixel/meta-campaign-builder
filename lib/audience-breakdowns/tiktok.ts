/**
 * lib/audience-breakdowns/tiktok.ts
 *
 * TikTok audience breakdowns (dashboard v2 HE1, E1): the AUDIENCE report at
 * AUCTION_CAMPAIGN with stat_time_day, read twice per window: by age and
 * gender together, and by province_id folded to the UK nation. Spend,
 * impressions and clicks only: TikTok doesn't report results by age
 * reliably, so the panel says "TikTok reports clicks by age, not signups or
 * sales" (E1). Campaign names come from /campaign/get/.
 *
 * Every request is counted. A rate limit (50001) or an auth refusal stops
 * the advertiser and is reported; the caller moves on. The production
 * request is lib/tiktok/client.ts's tiktokGet, which itself waits once and
 * retries a 50001 and retries a 5xx; those retries are inside one counted
 * call.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { TikTokApiError } from "../tiktok/client.ts";

export type TikTokBreakdown = "age_gender" | "nation";

export const TIKTOK_BREAKDOWNS: readonly TikTokBreakdown[] = ["age_gender", "nation"];

export const TIKTOK_BREAKDOWN_DIMENSIONS: Record<TikTokBreakdown, string[]> = {
  age_gender: ["campaign_id", "stat_time_day", "age", "gender"],
  nation: ["campaign_id", "stat_time_day", "province_id"],
};

export const TIKTOK_BREAKDOWN_METRICS = ["spend", "impressions", "clicks"];

/** TikTok's province_id is a GeoNames id; the UK's four are its nations. */
export const UK_NATION_BY_PROVINCE: Readonly<Record<string, string>> = {
  "6269131": "England",
  "2638360": "Scotland",
  "2634895": "Wales",
  "2641364": "Northern Ireland",
};
export const OUTSIDE_UK = "Outside the UK";
export const UNKNOWN = "Unknown";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MAX_WINDOW_DAYS = 30;
const NAME_CHUNK = 100;

export type TikTokRequest = <T>(path: string, params: Record<string, unknown>, token: string) => Promise<T>;

export type TikTokBreakdownRow = {
  tiktok_campaign_id: string;
  date: string;
  breakdown: TikTokBreakdown;
  age: string;
  gender: string;
  nation: string;
  advertiser_id: string;
  /** Present only when known; never sent as NULL. */
  campaign_name?: string;
  event_id?: string;
  spend: number;
  impressions: number;
  clicks: number;
  fetched_at: string;
};

export type TikTokFetchStatus = "ok" | "rate_limited" | "auth_error" | "error";

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "AGE_25_34" → "25-34", "AGE_55_100" → "55+", "NONE" → "unknown". */
export function tiktokAge(raw: string | undefined): string {
  const m = /^AGE_(\d+)_(\d+)$/.exec((raw ?? "").trim());
  if (!m) return "unknown";
  return m[2] === "100" ? `${m[1]}+` : `${m[1]}-${m[2]}`;
}

/** "MALE" → "male", "FEMALE" → "female", anything else → "unknown" (Meta's words). */
export function tiktokGender(raw: string | undefined): string {
  const g = (raw ?? "").trim().toUpperCase();
  return g === "MALE" ? "male" : g === "FEMALE" ? "female" : "unknown";
}

/** A province id to the UK nation, "Outside the UK", or "Unknown" (TikTok's -1 / none). */
export function ukNation(provinceId: string | undefined): string {
  const id = (provinceId ?? "").trim();
  if (UK_NATION_BY_PROVINCE[id]) return UK_NATION_BY_PROVINCE[id];
  if (id === "" || id === "-1" || /^none$/i.test(id) || !/^\d+$/.test(id)) return UNKNOWN;
  return OUTSIDE_UK;
}

export function tiktokRowKey(r: Pick<TikTokBreakdownRow, "tiktok_campaign_id" | "date" | "breakdown" | "age" | "gender" | "nation">): string {
  return [r.tiktok_campaign_id, r.date, r.breakdown, r.age, r.gender, r.nation].join("|");
}

/** TikTok's codes for a token or advertiser it won't serve. */
export function isTikTokAuthError(err: unknown): boolean {
  if (!(err instanceof TikTokApiError)) return false;
  if (err.code != null && [40001, 40100, 40102, 40104, 40105].includes(err.code)) return true;
  return err.httpStatus === 401 || err.httpStatus === 403;
}

export function tiktokWindows(since: string, until: string): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  const end = Date.parse(`${until}T00:00:00Z`);
  for (let start = Date.parse(`${since}T00:00:00Z`); start <= end; start += MAX_WINDOW_DAYS * 86_400_000) {
    const stop = Math.min(start + (MAX_WINDOW_DAYS - 1) * 86_400_000, end);
    out.push({ since: new Date(start).toISOString().slice(0, 10), until: new Date(stop).toISOString().slice(0, 10) });
  }
  return out;
}

type ReportResponse = {
  list?: { dimensions?: Record<string, string | undefined>; metrics?: Record<string, unknown> }[];
  page_info?: { page?: number; total_page?: number };
};

type CampaignGetResponse = {
  list?: { campaign_id?: string; campaign_name?: string }[];
  page_info?: { page?: number; total_page?: number };
};

export type TikTokAdvertiserFetch = {
  status: TikTokFetchStatus;
  calls: number;
  rows: TikTokBreakdownRow[];
  /** Campaign id → name, as /campaign/get/ gave it. Empty when that read failed. */
  names: Map<string, string>;
  error?: string;
  /** A breakdown that failed on its own (not a rate limit or auth), with the reason. */
  breakdownErrors?: { breakdown: TikTokBreakdown; error: string }[];
};

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof TikTokApiError ? err.code : undefined;
  return code != null ? `TikTok code=${code}: ${message}` : message;
}

/**
 * Both breakdowns for one advertiser over `since..until`, then the names.
 * Rows come back unattributed, keyed on the table's primary key.
 */
export async function fetchTikTokAdvertiserBreakdowns(input: {
  request: TikTokRequest;
  advertiserId: string;
  token: string;
  since: string;
  until: string;
  now: Date;
  breakdowns?: readonly TikTokBreakdown[];
}): Promise<TikTokAdvertiserFetch> {
  const fetchedAt = input.now.toISOString();
  const byKey = new Map<string, TikTokBreakdownRow>();
  const breakdownErrors: { breakdown: TikTokBreakdown; error: string }[] = [];
  let calls = 0;
  const stop = (err: unknown): TikTokAdvertiserFetch | null => {
    if (err instanceof TikTokApiError && err.code === 50001) return { status: "rate_limited", calls, rows: [], names: new Map(), error: errorText(err) };
    if (isTikTokAuthError(err)) return { status: "auth_error", calls, rows: [], names: new Map(), error: errorText(err) };
    return null;
  };

  for (const breakdown of input.breakdowns ?? TIKTOK_BREAKDOWNS) {
    // A breakdown's rows are kept only once every window and page of it is read.
    const mine = new Map<string, TikTokBreakdownRow>();
    try {
      for (const window of tiktokWindows(input.since, input.until)) {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          calls++;
          const res = await input.request<ReportResponse>(
            "/report/integrated/get/",
            {
              advertiser_id: input.advertiserId,
              report_type: "AUDIENCE",
              data_level: "AUCTION_CAMPAIGN",
              dimensions: TIKTOK_BREAKDOWN_DIMENSIONS[breakdown],
              metrics: TIKTOK_BREAKDOWN_METRICS,
              start_date: window.since,
              end_date: window.until,
              page,
              page_size: PAGE_SIZE,
            },
            input.token,
          );
          for (const item of res.list ?? []) {
            const d = item.dimensions ?? {};
            const m = item.metrics ?? {};
            const campaignId = d.campaign_id?.trim();
            const date = d.stat_time_day?.slice(0, 10);
            if (!campaignId || !date) continue;
            const row: TikTokBreakdownRow = {
              tiktok_campaign_id: campaignId,
              date,
              breakdown,
              age: breakdown === "age_gender" ? tiktokAge(d.age) : "",
              gender: breakdown === "age_gender" ? tiktokGender(d.gender) : "",
              nation: breakdown === "nation" ? ukNation(d.province_id) : "",
              advertiser_id: input.advertiserId,
              spend: 0,
              impressions: 0,
              clicks: 0,
              fetched_at: fetchedAt,
            };
            // Several provinces fold into "Outside the UK": sum them.
            const key = tiktokRowKey(row);
            const into = mine.get(key) ?? row;
            into.spend = Math.round((into.spend + num(m.spend)) * 100) / 100;
            into.impressions += Math.round(num(m.impressions));
            into.clicks += Math.round(num(m.clicks));
            mine.set(key, into);
          }
          if (!res.page_info?.total_page || page >= res.page_info.total_page) break;
        }
      }
      for (const [key, row] of mine) if (row.spend > 0 || row.impressions > 0) byKey.set(key, row);
    } catch (err) {
      const stopped = stop(err);
      if (stopped) return stopped;
      breakdownErrors.push({ breakdown, error: errorText(err) });
    }
  }

  const rows = [...byKey.values()];
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.tiktok_campaign_id))];
  let nameError: string | undefined;
  try {
    for (let i = 0; i < ids.length; i += NAME_CHUNK) {
      const chunk = ids.slice(i, i + NAME_CHUNK);
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        calls++;
        const res = await input.request<CampaignGetResponse>(
          "/campaign/get/",
          {
            advertiser_id: input.advertiserId,
            filtering: { campaign_ids: chunk },
            fields: ["campaign_id", "campaign_name"],
            page,
            page_size: NAME_CHUNK,
          },
          input.token,
        );
        for (const c of res.list ?? []) if (c.campaign_id && c.campaign_name) names.set(c.campaign_id, c.campaign_name);
        if (!res.page_info?.total_page || page >= res.page_info.total_page) break;
      }
    }
  } catch (err) {
    const stopped = stop(err);
    if (stopped) return stopped;
    nameError = `campaign names: ${errorText(err)}`;
    names.clear();
  }
  for (const row of rows) {
    const name = names.get(row.tiktok_campaign_id)?.trim();
    if (name) row.campaign_name = name;
  }

  const failed = breakdownErrors.length > 0 || nameError != null;
  return {
    status: failed ? "error" : "ok",
    calls,
    rows,
    names,
    ...(failed ? { error: [...breakdownErrors.map((e) => `${e.breakdown}: ${e.error}`), ...(nameError ? [nameError] : [])].join("; ") } : {}),
    ...(breakdownErrors.length ? { breakdownErrors } : {}),
  };
}
