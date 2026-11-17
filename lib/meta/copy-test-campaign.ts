/**
 * A copy test in its own campaign (the A/B copy test, #1285; Matas's rulings of 17 Nov).
 *
 * One small campaign per test, holding one ad set:
 *   - the campaign: OUTCOME_SALES, PAUSED, a campaign daily budget (CBO) set
 *     to the test budget, in minor units, exactly as given (never rounded up);
 *   - the ad set: the source ad set copied as it stands (targeting, which
 *     carries placements and Advantage+ audience; optimisation goal; promoted
 *     object; attribution; destination), PAUSED, no budget of its own, ending
 *     23:59 London 4 days after creation;
 *   - the ads, PAUSED: each one the source ad's creative with only the primary
 *     text changed (A / B), or, for an image card, the source creative's page,
 *     Instagram account, link and button with the card's image.
 *
 * Every create goes through meta_write_idempotency with `required: true`, keyed
 * on the test's own draft, so a retry returns the id already made and never
 * makes a second campaign, ad set or ad. Nothing here switches anything on.
 * Each ad set and ad gets its launched_ad_sets / launched_ads row.
 *
 * Meta, the ledger and the record writers are passed in: this file never
 * imports lib/meta/client.ts, so tests run on fakes.
 */

import { buildCampaignPayload } from "./campaign.ts";
import { sanitizeCreativeForStrictMode, type MetaCreativePayload } from "./creative.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

type Json = Record<string, unknown>;

export const COPY_TEST_DAYS = 4;

/** "{code} · AB copy test" (Matas, 17 Nov). Not "{code} · Tests", which the creative-tests code owns (TT1). */
export function copyTestName(eventCode: string): string {
  return `${eventCode} · AB copy test`;
}

/** London's calendar date of an instant, YYYY-MM-DD. */
export function londonDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 23:59 London on a day, with that day's offset, as Meta takes it. */
export function londonEndOfDay(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(noon).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const hours = Number(offset.match(/GMT([+-]\d+)?/)?.[1] ?? 0);
  return `${day}T23:59:00${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}00`;
}

/** The test's end: 23:59 London, COPY_TEST_DAYS days after the London day it is created. */
export function copyTestEndTime(createdAt: Date, days = COPY_TEST_DAYS): { day: string; endTime: string } {
  const day = addDays(londonDay(createdAt), days);
  return { day, endTime: londonEndOfDay(day) };
}

/** The campaign: OUTCOME_SALES, paused, the test budget as the campaign's daily budget (minor units, as given). */
export function copyTestCampaignPayload(name: string, dailyMinor: number): Json {
  if (!Number.isInteger(dailyMinor) || dailyMinor <= 0) throw new Error(`The daily budget must be a whole number of pence (got ${dailyMinor})`);
  const payload = buildCampaignPayload({ name, objective: "purchase", status: "PAUSED", budget: { level: "campaign", type: "daily", amountMajor: dailyMinor / 100 } }) as unknown as Json;
  if (payload.daily_budget !== dailyMinor) throw new Error(`The campaign payload's budget is ${String(payload.daily_budget)}, not ${dailyMinor}`);
  return payload;
}

/** What the copy keeps from its source ad set, besides targeting and the promoted object. */
export const COPIED_ADSET_FIELDS = ["optimization_goal", "billing_event", "attribution_spec", "destination_type", "adset_schedule"] as const;

/**
 * The ad set copy: its source as it stands, in the test campaign, paused, with no budget
 * (the campaign holds it) and no bid strategy (the campaign's), ending at `endTime`.
 * `smart_pse_enabled` is Meta's read-back default and is left off the write.
 */
export function copyTestAdSetPayload(src: Json, args: { campaignId: string; name: string; endTime: string }): Json {
  if (!src.targeting || typeof src.targeting !== "object") throw new Error("The source ad set has no targeting to copy");
  if (!src.promoted_object || typeof src.promoted_object !== "object") throw new Error("The source ad set has no promoted object to copy");
  const promoted: Json = { ...(src.promoted_object as Json) };
  delete promoted.smart_pse_enabled;
  const payload: Json = {
    name: args.name,
    campaign_id: args.campaignId,
    status: "PAUSED",
    targeting: src.targeting,
    promoted_object: promoted,
    is_dynamic_creative: false,
    end_time: args.endTime,
  };
  for (const field of COPIED_ADSET_FIELDS) if (src[field] != null) payload[field] = src[field];
  return payload;
}

/** Strip Meta's label ids (they belong to the source creative); a new creative links labels by name. */
function labelsByName(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(labelsByName);
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const [key, inner] of Object.entries(value as Json)) {
    if ((key === "adlabels" || key.endsWith("_label")) && inner) {
      out[key] = Array.isArray(inner) ? inner.map((label) => ({ name: (label as Json).name })) : { name: (inner as Json).name };
    } else {
      out[key] = labelsByName(inner);
    }
  }
  return out;
}

/**
 * A new creative from the source creative with only the primary text changed.
 * Video creatives (object_story_spec.video_data) keep the video, thumbnail, button and link;
 * placement creatives (asset_feed_spec) keep every asset, rule, title and description, with
 * the one body replaced. The source's url_tags stay. Enhancements are the app's strict set
 * (sanitizeCreativeForStrictMode): Meta refuses most of the read-back feature keys on a create.
 */
export function copyTestCreativePayload(src: Json, args: { name: string; message: string }): Json {
  const oss = (src.object_story_spec ?? {}) as Json;
  const pageId = oss.page_id;
  if (!pageId) throw new Error("The source creative has no page");
  const identity: Json = { page_id: pageId };
  if (oss.instagram_user_id) identity.instagram_user_id = oss.instagram_user_id;
  let payload: Json;
  if (oss.video_data) {
    const vd = oss.video_data as Json;
    if (!vd.video_id) throw new Error("The source creative's video has no id");
    const video: Json = { video_id: vd.video_id, message: args.message };
    if (vd.image_hash) video.image_hash = vd.image_hash;
    else if (vd.image_url) video.image_url = vd.image_url;
    if (vd.call_to_action) video.call_to_action = vd.call_to_action;
    if (vd.title) video.title = vd.title;
    if (vd.link_description) video.link_description = vd.link_description;
    payload = { name: args.name, object_story_spec: { ...identity, video_data: video } };
  } else if (src.asset_feed_spec) {
    const afs = labelsByName(src.asset_feed_spec) as Json;
    const bodies = afs.bodies as unknown[] | undefined;
    if (!Array.isArray(bodies) || bodies.length !== 1) throw new Error("The source creative's asset feed must have exactly one body");
    payload = { name: args.name, object_story_spec: identity, asset_feed_spec: { ...afs, bodies: [{ ...(bodies[0] as Json), text: args.message }] } };
  } else {
    throw new Error("The source creative is neither a video nor a placement creative");
  }
  if (typeof src.url_tags === "string" && src.url_tags) payload.url_tags = src.url_tags;
  sanitizeCreativeForStrictMode(payload as unknown as MetaCreativePayload);
  return payload;
}

/** An image card: the source video creative's page, Instagram account, link and button, with the card's image and the line. */
export function copyTestCardPayload(src: Json, args: { name: string; message: string; imageHash: string }): Json {
  const oss = (src.object_story_spec ?? {}) as Json;
  const vd = (oss.video_data ?? {}) as Json;
  const cta = vd.call_to_action as { type?: string; value?: { link?: string } } | undefined;
  const link = cta?.value?.link;
  if (!oss.page_id || !link || !cta?.type) throw new Error("The source creative has no page, link or button to reuse");
  const identity: Json = { page_id: oss.page_id };
  if (oss.instagram_user_id) identity.instagram_user_id = oss.instagram_user_id;
  const payload: Json = {
    name: args.name,
    object_story_spec: { ...identity, link_data: { image_hash: args.imageHash, link, message: args.message, call_to_action: { type: cta.type, value: { link } } } },
  };
  if (typeof src.url_tags === "string" && src.url_tags) payload.url_tags = src.url_tags;
  sanitizeCreativeForStrictMode(payload as unknown as MetaCreativePayload);
  return payload;
}

export type CopyTestAdSpec =
  | { kind: "copy"; label: string; adName: string; message: string }
  | { kind: "card"; label: string; adName: string; message: string; image: { fileName: string; bytes: Uint8Array } };

export type CopyTestSpec = {
  eventCode: string;
  campaignName: string;
  adSetName: string;
  adAccountId: string;
  /** The campaign's daily budget, minor units, as ruled. */
  dailyMinor: number;
  sourceAdSetId: string;
  sourceCreativeId: string;
  ads: CopyTestAdSpec[];
};

export type CopyTestMeta = {
  readAdSet(adsetId: string): Promise<Json | null>;
  readCreative(creativeId: string): Promise<Json | null>;
  /** The ad account's min_daily_budget, minor units, or null when it can't be read. */
  readMinDailyBudget(adAccountId: string): Promise<number | null>;
  createCampaign(adAccountId: string, payload: Json): Promise<string>;
  createAdSet(adAccountId: string, payload: Json): Promise<string>;
  /** POST /act_{id}/adimages. Returns the hash. */
  uploadImage(adAccountId: string, image: { fileName: string; bytes: Uint8Array }): Promise<string>;
  createCreative(adAccountId: string, payload: Json): Promise<string>;
  createAd(adAccountId: string, payload: Json): Promise<string>;
};

export type CopyTestRecorders = {
  adSet(row: { metaAdsetId: string; metaCampaignId: string; source: Json; dailyMinor: number }): Promise<void>;
  ad(row: { metaAdId: string; metaCreativeId: string; metaAdsetId: string; metaCampaignId: string; adName: string; creative: Json }): Promise<void>;
};

export type CopyTestResult = {
  campaignId: string;
  adSetId: string;
  endDay: string;
  endTime: string;
  ads: { label: string; adName: string; adId: string; creativeId: string; imageHash?: string }[];
  /** Meta creates this run sent (a ledger hit sends none). */
  writes: number;
};

/**
 * One run per test at a time. meta_write_idempotency is not a lock: a step whose
 * row is still `pending` runs again, so two runs of the same test that overlap
 * each make the object (17 Nov: P26-BDAY got two ad sets, each with an A and a B,
 * from a P26-only run started while a combined run was mid-test). The lock is
 * taken before the first read and released at the end, whatever happens.
 */
export type CopyTestLock = {
  /** True when this run holds the test; false when another run does. Must fail closed. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
};

export const LOCK_STALE_MINUTES = 15;

/** The PostgREST or-filter that claims the test: no run recorded, or the recorded run is older than the stale cutoff. */
export function copyTestLockFilter(staleBeforeIso: string): string {
  return `draft_json->copyTestRun.is.null,draft_json->copyTestRun->>at.lt."${staleBeforeIso}"`;
}

export class CopyTestStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyTestStop";
  }
}

/** Meta writes for a test: campaign, ad set, and per ad a creative and an ad (plus an image upload per card). */
export function copyTestWriteCount(spec: Pick<CopyTestSpec, "ads">): number {
  return 2 + spec.ads.reduce((sum, ad) => sum + (ad.kind === "card" ? 3 : 2), 0);
}

/**
 * Makes one test, in order: campaign, ad set, then per ad (image), creative, ad.
 * A failed step throws; everything made before it stays paused, and a rerun picks up
 * from the ledger. The budget is checked against the account's minimum before any write.
 */
export async function createCopyTest(
  deps: { meta: CopyTestMeta; ledger: MetaWriteContext; record: CopyTestRecorders; lock: CopyTestLock; now?: Date },
  spec: CopyTestSpec,
): Promise<CopyTestResult> {
  if (!(await deps.lock.acquire())) throw new CopyTestStop(`Another run of ${spec.campaignName} is in progress, so this run made nothing`);
  try {
    return await createCopyTestLocked(deps, spec);
  } finally {
    await deps.lock.release();
  }
}

async function createCopyTestLocked(
  deps: { meta: CopyTestMeta; ledger: MetaWriteContext; record: CopyTestRecorders; now?: Date },
  spec: CopyTestSpec,
): Promise<CopyTestResult> {
  const { meta, ledger, record } = deps;
  const minimum = await meta.readMinDailyBudget(spec.adAccountId);
  if (minimum == null) throw new CopyTestStop(`act_${spec.adAccountId}'s min_daily_budget couldn't be read, so nothing was made`);
  if (spec.dailyMinor < minimum) throw new CopyTestStop(`${spec.dailyMinor} is under act_${spec.adAccountId}'s minimum of ${minimum}, so nothing was made`);
  const source = await meta.readAdSet(spec.sourceAdSetId);
  if (!source) throw new CopyTestStop(`The source ad set ${spec.sourceAdSetId} can't be read`);
  const creative = await meta.readCreative(spec.sourceCreativeId);
  if (!creative) throw new CopyTestStop(`The source creative ${spec.sourceCreativeId} can't be read`);

  const { day: endDay, endTime } = copyTestEndTime(deps.now ?? new Date());
  // Build every payload before the first write, so a bad source stops the test with nothing made.
  const campaignPayload = copyTestCampaignPayload(spec.campaignName, spec.dailyMinor);
  copyTestAdSetPayload(source, { campaignId: "0", name: spec.adSetName, endTime });
  for (const ad of spec.ads) {
    if (ad.kind === "copy") copyTestCreativePayload(creative, { name: ad.adName, message: ad.message });
    else copyTestCardPayload(creative, { name: ad.adName, message: ad.message, imageHash: "0" });
  }

  let writes = 0;
  const once = (opKind: Parameters<typeof withMetaWriteIdempotency>[1], key: unknown, run: () => Promise<string>) =>
    withMetaWriteIdempotency(ledger, opKind, key, async () => {
      writes += 1;
      return run();
    }, { required: true });

  // The ledger keys name the step, not the payload: a campaign, an ad set or an ad is made once per test, whatever the end time.
  const campaignId = await once("campaign_create", { test: spec.campaignName }, () => meta.createCampaign(spec.adAccountId, campaignPayload));
  const adSetPayload = copyTestAdSetPayload(source, { campaignId, name: spec.adSetName, endTime });
  const adSetId = await once("adset_create", { test: spec.campaignName, source_adset_id: spec.sourceAdSetId }, () => meta.createAdSet(spec.adAccountId, adSetPayload));
  await record.adSet({ metaAdsetId: adSetId, metaCampaignId: campaignId, source, dailyMinor: spec.dailyMinor });

  const ads: CopyTestResult["ads"] = [];
  for (const ad of spec.ads) {
    let imageHash: string | undefined;
    let payload: Json;
    if (ad.kind === "card") {
      imageHash = await once("creative_upload", { test: spec.campaignName, image: ad.image.fileName }, () => meta.uploadImage(spec.adAccountId, ad.image));
      payload = copyTestCardPayload(creative, { name: ad.adName, message: ad.message, imageHash });
    } else {
      payload = copyTestCreativePayload(creative, { name: ad.adName, message: ad.message });
    }
    const creativeId = await once("creative_upload", { test: spec.campaignName, creative: ad.label }, () => meta.createCreative(spec.adAccountId, payload));
    const adPayload = { name: ad.adName, adset_id: adSetId, creative: { creative_id: creativeId }, status: "PAUSED" };
    const adId = await once("ad_create", { test: spec.campaignName, ad: ad.label }, () => meta.createAd(spec.adAccountId, adPayload));
    await record.ad({ metaAdId: adId, metaCreativeId: creativeId, metaAdsetId: adSetId, metaCampaignId: campaignId, adName: ad.adName, creative: payload });
    ads.push({ label: ad.label, adName: ad.adName, adId, creativeId, ...(imageHash ? { imageHash } : {}) });
  }
  return { campaignId, adSetId, endDay, endTime, ads, writes };
}
