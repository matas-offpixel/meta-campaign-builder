import { tiktokGet } from "../client.ts";

type TikTokGet = typeof tiktokGet;

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const EVENT_CODE_PREFIX = /^(\[[^\]]+\])/;

export const TIKTOK_CAMPAIGN_NAME_COLLISION_STEP =
  "Change the campaign name in Step 2";

export function tikTokEventCodePrefix(name: string): string | null {
  const match = name.trim().match(EVENT_CODE_PREFIX);
  return match?.[1] ?? null;
}

/**
 * Suggest an unused suffix. Never inserts before or inside `[EVENT_CODE]` —
 * reporting attribution parses that prefix.
 */
export function suggestTikTokCampaignNameAlternative(
  name: string,
  taken: Iterable<string> = [],
): string {
  const trimmed = name.trim();
  const takenSet = new Set(
    [...taken].map((value) => value.trim()).filter(Boolean),
  );
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${trimmed} (${n})`;
    if (!takenSet.has(candidate)) return candidate;
  }
  return `${trimmed} (retry)`;
}

export function isTikTokCampaignNameCollisionMessage(
  message: string | undefined,
): boolean {
  const text = message?.toLowerCase() ?? "";
  return (
    text.includes("campaign name already exists") ||
    (text.includes("campaign name") && text.includes("already exists"))
  );
}

export function tikTokCampaignNameCollisionMessage(
  name: string,
  taken: Iterable<string> = [],
): string {
  const trimmed = name.trim();
  const suggested = suggestTikTokCampaignNameAlternative(trimmed, taken);
  return `Campaign name "${trimmed}" is already used on this advertiser. ${TIKTOK_CAMPAIGN_NAME_COLLISION_STEP}. Suggested alternative: "${suggested}" — keep the [EVENT_CODE] prefix; reporting uses it.`;
}

export async function fetchAdvertiserCampaignNames(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<string[]> {
  const request = input.request ?? tiktokGet;
  const names: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await request<{
      list?: Array<{ campaign_id?: string; campaign_name?: string }>;
      page_info?: { total_page?: number };
    }>(
      "/campaign/get/",
      {
        advertiser_id: input.advertiserId,
        fields: ["campaign_id", "campaign_name"],
        page_size: PAGE_SIZE,
        page,
      },
      input.token,
    );
    for (const row of res.list ?? []) {
      if (typeof row.campaign_name === "string" && row.campaign_name.trim()) {
        names.push(row.campaign_name.trim());
      }
    }
    const totalPage = res.page_info?.total_page;
    if (!totalPage || page >= totalPage) break;
  }
  console.error(
    `[tiktok/launch] /campaign/get/ advertiser=${input.advertiserId} nameCount=${names.length}`,
  );
  return names;
}
