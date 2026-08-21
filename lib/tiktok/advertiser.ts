import { tiktokGet } from "./client.ts";

interface TikTokAdvertiserInfoRow {
  advertiser_id?: string;
  currency?: string;
  timezone?: string;
  display_timezone?: string;
}

interface TikTokAdvertiserInfoResponse {
  list?: TikTokAdvertiserInfoRow[];
}

type TikTokGet = typeof tiktokGet;

export interface TikTokAdvertiserInfo {
  currency: string | null;
  /** Activity / schedule timezone from `/advertiser/info/` `timezone`. */
  timezone: string | null;
  /** Reporting display timezone. Not used for schedule_*_time. */
  displayTimezone: string | null;
}

/**
 * Reads advertiser currency and timezone from official `/advertiser/info/`.
 *
 * Field names: AccountManagementApi `advertiser_info`
 * https://ads.tiktok.com/marketing_api/docs?id=1739593083610113
 * (SDK: python_sdk/docs/AccountManagementApi.md). The documented `fields`
 * enum includes `currency`, `timezone`, and `display_timezone`. `timezone`
 * is the account activity timezone; `display_timezone` is display-only.
 */
export async function fetchTikTokAdvertiserInfo(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAdvertiserInfo> {
  const request = input.request ?? tiktokGet;
  const res = await request<TikTokAdvertiserInfoResponse>(
    "/advertiser/info/",
    {
      advertiser_ids: [input.advertiserId],
      fields: ["currency", "timezone", "display_timezone"],
    },
    input.token,
  );

  const row = (res.list ?? []).find(
    (candidate) =>
      !candidate.advertiser_id || candidate.advertiser_id === input.advertiserId,
  );
  const currency = row?.currency?.trim();
  const timezone = row?.timezone?.trim();
  const displayTimezone = row?.display_timezone?.trim();
  return {
    currency: currency ? currency.toUpperCase() : null,
    timezone: timezone || null,
    displayTimezone: displayTimezone || null,
  };
}

/**
 * Reads the advertiser currency from official `/advertiser/info/`.
 * Returns null when TikTok omits the field rather than inventing GBP.
 */
export async function fetchTikTokAdvertiserCurrency(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<string | null> {
  const info = await fetchTikTokAdvertiserInfo(input);
  return info.currency;
}

export async function fetchTikTokAdvertiserTimezone(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<string | null> {
  const info = await fetchTikTokAdvertiserInfo(input);
  return info.timezone;
}
