import {
  buildMultiGetBatch,
  collectMultiGetResponses,
  type GraphBatchSubResponse,
} from "../graph-multi-get-parse.ts";
import {
  CREATIVE_BATCH_FIELDS,
  CREATIVE_BATCH_SIZE,
} from "../creative-batch-fields.ts";
import {
  META_IMPORT_AD_FIELDS,
  META_IMPORT_ADSET_FIELDS,
  META_IMPORT_CAMPAIGN_FIELDS,
  META_IMPORT_EXTRA_PAGE_SLEEP_MS,
  META_IMPORT_PAGE_LIMIT,
  type MetaImportRequest,
  type MetaLiveCampaignBundle,
} from "./types.ts";

type Paged = {
  data?: unknown[];
  paging?: { cursors?: { after?: string }; next?: string };
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Meta import failed: ${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function asPaged(value: unknown, path: string): Paged {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Meta import failed: ${path} was not a paged object`);
  }
  return value as Paged;
}

function normalizeAdAccountId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed;
}

function creativeIdFromAd(ad: Record<string, unknown>): string | null {
  const creative = ad.creative;
  if (typeof creative === "string" && creative) return creative;
  if (creative && typeof creative === "object" && !Array.isArray(creative)) {
    const id = (creative as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function pageAll(
  request: MetaImportRequest,
  path: string,
  fields: string,
  token: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let after: string | undefined;
  let page = 0;
  for (;;) {
    if (page > 0) await sleep(META_IMPORT_EXTRA_PAGE_SLEEP_MS);
    const params: Record<string, string> = {
      fields,
      limit: String(META_IMPORT_PAGE_LIMIT),
    };
    if (after) params.after = after;
    const res = asPaged(await request.get(path, params, token), path);
    for (const row of res.data ?? []) {
      rows.push(asRecord(row, `${path} row`));
    }
    const next = res.paging?.cursors?.after;
    if (!next || !res.paging?.next) break;
    after = next;
    page += 1;
  }
  return rows;
}

async function fetchCreativesById(
  request: MetaImportRequest,
  ids: string[],
  token: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, Record<string, unknown>>> {
  const unique = [...new Set(ids)];
  const out: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < unique.length; i += CREATIVE_BATCH_SIZE) {
    if (i > 0) await sleep(META_IMPORT_EXTRA_PAGE_SLEEP_MS);
    const chunk = unique.slice(i, i + CREATIVE_BATCH_SIZE);
    const batch = await request.post(
      "/",
      {
        batch: buildMultiGetBatch(chunk, CREATIVE_BATCH_FIELDS),
        include_headers: false,
      },
      token,
    );
    Object.assign(
      out,
      collectMultiGetResponses<Record<string, unknown>>(
        (Array.isArray(batch) ? batch : []) as GraphBatchSubResponse[],
      ),
    );
  }
  return out;
}

/**
 * The intended import reads. No mapping. Empty legs throw rather
 * than producing an empty bundle — same doctrine as TikTok
 * `readers.ts:596-640`.
 *
 * Does not call the picker ad-set listing helper. That picker read
 * keeps its deliberately-minimal `targeting{…}` subset; this reader
 * requests wholesale `targeting` so a capture can answer whether
 * `cities[].key` comes back.
 */
export async function readMetaLiveCampaign(input: {
  adAccountId: string;
  campaignId: string;
  token: string;
  request: MetaImportRequest;
  sleep?: (ms: number) => Promise<void>;
}): Promise<MetaLiveCampaignBundle> {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const campaignPath = `/${input.campaignId}`;
  const campaign = asRecord(
    await input.request.get(
      campaignPath,
      { fields: META_IMPORT_CAMPAIGN_FIELDS },
      input.token,
    ),
    campaignPath,
  );

  const expectedAccount = normalizeAdAccountId(input.adAccountId);
  const gotAccount =
    typeof campaign.account_id === "string"
      ? normalizeAdAccountId(campaign.account_id)
      : "";
  if (gotAccount !== expectedAccount) {
    throw new Error(
      `Meta import failed: campaign ${input.campaignId} is on account ${gotAccount || "unknown"}, not ${expectedAccount}`,
    );
  }

  const adSets = await pageAll(
    input.request,
    `/${input.campaignId}/adsets`,
    META_IMPORT_ADSET_FIELDS,
    input.token,
    sleep,
  );
  if (adSets.length === 0) {
    throw new Error(
      `Meta import failed: /{campaign_id}/adsets returned no ad sets for ${input.campaignId}`,
    );
  }

  const ads = await pageAll(
    input.request,
    `/${input.campaignId}/ads`,
    META_IMPORT_AD_FIELDS,
    input.token,
    sleep,
  );
  if (ads.length === 0) {
    throw new Error(
      `Meta import failed: /{campaign_id}/ads returned no ads for ${input.campaignId}`,
    );
  }

  const creativeIds = ads
    .map(creativeIdFromAd)
    .filter((id): id is string => id != null);
  if (creativeIds.length === 0) {
    throw new Error(
      `Meta import failed: ${ads.length} ads on ${input.campaignId} had no creative id`,
    );
  }

  const creatives = await fetchCreativesById(
    input.request,
    creativeIds,
    input.token,
    sleep,
  );
  if (Object.keys(creatives).length === 0) {
    throw new Error(
      `Meta import failed: creative batch returned no creatives for ${input.campaignId} (${creativeIds.length} ids)`,
    );
  }

  return { campaign, adSets, ads, creatives };
}
