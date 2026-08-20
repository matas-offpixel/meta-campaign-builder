import { tiktokGet } from "./client.ts";

interface TikTokAdvertiserInfoRow {
  advertiser_id?: string;
  currency?: string;
}

interface TikTokAdvertiserInfoResponse {
  list?: TikTokAdvertiserInfoRow[];
}

type TikTokGet = typeof tiktokGet;

/**
 * Reads the advertiser currency from official `/advertiser/info/`.
 * Returns null when TikTok omits the field rather than inventing GBP.
 */
export async function fetchTikTokAdvertiserCurrency(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<string | null> {
  const request = input.request ?? tiktokGet;
  const res = await request<TikTokAdvertiserInfoResponse>(
    "/advertiser/info/",
    {
      advertiser_ids: [input.advertiserId],
      fields: ["currency"],
    },
    input.token,
  );

  const row = (res.list ?? []).find(
    (candidate) =>
      !candidate.advertiser_id || candidate.advertiser_id === input.advertiserId,
  );
  const currency = row?.currency?.trim();
  return currency ? currency.toUpperCase() : null;
}
