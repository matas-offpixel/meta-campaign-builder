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
export function copyTestCreativePayload(src: Json, args: { name: string; message: string; postAs?: PromoterIdentity }): Json {
  const oss = (src.object_story_spec ?? {}) as Json;
  const pageId = args.postAs?.pageId ?? oss.page_id;
  if (!pageId) throw new Error("The source creative has no page");
  const identity: Json = { page_id: pageId };
  const instagram = args.postAs ? args.postAs.instagramId : oss.instagram_user_id;
  if (instagram) identity.instagram_user_id = instagram;
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
  } else if (oss.link_data) {
    // A single-image creative (lineup artwork, a card): same image, link and button.
    const ld = oss.link_data as Json;
    if (!ld.image_hash || !ld.link) throw new Error("The source creative's image has no hash or link");
    const link: Json = { image_hash: ld.image_hash, link: ld.link, message: args.message };
    if (ld.call_to_action) link.call_to_action = ld.call_to_action;
    if (ld.name) link.name = ld.name;
    if (ld.description) link.description = ld.description;
    payload = { name: args.name, object_story_spec: { ...identity, link_data: link } };
  } else if (src.asset_feed_spec) {
    const afs = labelsByName(src.asset_feed_spec) as Json;
    const bodies = afs.bodies as unknown[] | undefined;
    if (!Array.isArray(bodies) || bodies.length !== 1) throw new Error("The source creative's asset feed must have exactly one body");
    payload = { name: args.name, object_story_spec: identity, asset_feed_spec: { ...afs, bodies: [{ ...(bodies[0] as Json), text: args.message }] } };
  } else {
    throw new Error("The source creative is not a video, image or placement creative");
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
  /** The show's promoter/venue page + Instagram pairs (promoterIdentities). A creative on anything else is refused. */
  identities: PromoterIdentity[];
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
  /** GET /{ad}: its name, ad set, status and creative id. */
  readAd?(adId: string): Promise<{ id: string; name: string; adsetId: string; campaignId: string; status: string; creativeId: string | null } | null>;
  /** POST /{ad} with a new creative and name. Never a status. */
  updateAd?(adId: string, fields: { creative: { creative_id: string }; name: string }): Promise<void>;
  /** POST /{ad} { status: "ARCHIVED" }. Never DELETED. */
  archiveAd?(adId: string): Promise<void>;
};

export type CopyTestRecorders = {
  adSet(row: { metaAdsetId: string; metaCampaignId: string; source: Json; dailyMinor: number }): Promise<void>;
  ad(row: { metaAdId: string; metaCreativeId: string; metaAdsetId: string; metaCampaignId: string; adName: string; creative: Json }): Promise<void>;
  /** Keeps an archived ad's launched_ads row, marked. */
  archivedAd?(row: { metaAdId: string; replacedBy: string }): Promise<void>;
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

// ─── Promoter identity guard (Matas, 17 Nov) ─────────────────────────────────
// Copy tests are promoter copy: every A and B ad posts as the show's promoter or
// venue page and its Instagram account, never as an artist. Artist-page ads carry
// the artist's own signed-off caption, which is never changed.

export type PromoterIdentity = { pageId: string; instagramId: string };

/** Meta page categories that mean an artist's own page. */
export const ARTIST_PAGE_CATEGORIES: ReadonlySet<string> = new Set(["musician/band", "musician", "artist", "dj", "band", "producer"]);

export type PageFacts = { id: string; category: string | null; linkedInstagramId: string | null };

/**
 * The show's promoter/venue identities, from data: a page qualifies when it is on the
 * show's own ads, or is the client's page on record and promotable on the show's ad
 * account; and its Meta category isn't an artist's. Its Instagram is the account
 * linked to the page on Meta, never another account paired with it on an ad.
 */
export function promoterIdentities(input: {
  clientPageIds: readonly string[];
  promotablePageIds: readonly string[];
  showAdPageIds: readonly string[];
  pages: readonly PageFacts[];
}): PromoterIdentity[] {
  const promotable = new Set(input.promotablePageIds);
  const candidates = new Set([...input.showAdPageIds, ...input.clientPageIds.filter((id) => promotable.has(id))]);
  const out: PromoterIdentity[] = [];
  for (const id of candidates) {
    const page = input.pages.find((p) => p.id === id);
    if (!page?.linkedInstagramId) continue;
    if (ARTIST_PAGE_CATEGORIES.has((page.category ?? "").trim().toLowerCase())) continue;
    out.push({ pageId: id, instagramId: page.linkedInstagramId });
  }
  return out;
}

/** The page and Instagram a creative payload posts as. */
export function creativeIdentity(payload: Json): { pageId: string | null; instagramId: string | null } {
  const oss = (payload.object_story_spec ?? {}) as Json;
  const page = oss.page_id ?? null;
  const ig = oss.instagram_user_id ?? payload.instagram_user_id ?? null;
  return { pageId: page == null ? null : String(page), instagramId: ig == null ? null : String(ig) };
}

/** Throws unless the creative posts as one of the show's promoter/venue identities, page and Instagram together. */
export function assertPromoterIdentity(eventCode: string, payload: Json, identities: readonly PromoterIdentity[]): void {
  if (!identities.length) throw new CopyTestStop(`${eventCode} has no promoter or venue page on record, so nothing was made`);
  const { pageId, instagramId } = creativeIdentity(payload);
  const ok = identities.some((id) => id.pageId === pageId && id.instagramId === instagramId);
  if (!ok) {
    throw new CopyTestStop(`${String(payload.name ?? "The creative")} would post as page ${pageId ?? "none"} / Instagram ${instagramId ?? "none"}, which isn't ${eventCode}'s promoter or venue page, so nothing was made`);
  }
}

/**
 * A page Matas ruled for a test (17 Nov), added to the data's list: still refused when
 * Meta calls it an artist page, or when the Instagram isn't the one linked to it.
 */
export function withRuledIdentity(identities: readonly PromoterIdentity[], ruled: PromoterIdentity, page: PageFacts | null): PromoterIdentity[] {
  if (!page || page.id !== ruled.pageId) throw new CopyTestStop(`The ruled page ${ruled.pageId} can't be read`);
  if (ARTIST_PAGE_CATEGORIES.has((page.category ?? "").trim().toLowerCase())) throw new CopyTestStop(`The ruled page ${ruled.pageId} is an artist page (${page.category}), so nothing was made`);
  if (!page.linkedInstagramId) throw new CopyTestStop(`The ruled page ${ruled.pageId} has no linked Instagram account, so nothing was made`);
  if (page.linkedInstagramId !== ruled.instagramId) throw new CopyTestStop(`Instagram ${ruled.instagramId} isn't the account linked to page ${ruled.pageId} (${page.linkedInstagramId}), so nothing was made`);
  return identities.some((id) => id.pageId === ruled.pageId && id.instagramId === ruled.instagramId) ? [...identities] : [...identities, ruled];
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
    const payload = ad.kind === "copy" ? copyTestCreativePayload(creative, { name: ad.adName, message: ad.message }) : copyTestCardPayload(creative, { name: ad.adName, message: ad.message, imageHash: "0" });
    assertPromoterIdentity(spec.eventCode, payload, spec.identities);
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

export type RepointResult = {
  ads: { label: string; adId: string; creativeId: string; action: "already" | "repointed" | "replaced"; archivedAdId?: string }[];
  writes: number;
};

/**
 * One existing paused ad to move. "source": a new creative from `spec.sourceCreativeId`
 * with the ad's approved line and name. "identity": the ad's own creative (a card) kept
 * as it is, with only the page and Instagram changed.
 */
export type RepointRow = { label: string; adId: string; mode: "source" | "identity" };

function creativeMessage(creative: Json | null): string | undefined {
  const oss = (creative?.object_story_spec ?? {}) as Json;
  const fromStory = ((oss.video_data as Json | undefined)?.message ?? (oss.link_data as Json | undefined)?.message) as string | undefined;
  return fromStory ?? (((creative?.asset_feed_spec as Json | undefined)?.bodies as Json[] | undefined)?.[0]?.text as string | undefined);
}

/**
 * Moves a test's existing paused ads onto the promoter/venue identity `postAs`: per ad,
 * a new creative (from the new source, or the ad's own creative with only the page
 * changed), then the ad's creative and name swapped (POST /{ad}; never a status). If
 * Meta refuses the swap, the old ad is archived (never deleted) and a new paused ad made
 * in the same ad set. An ad already posting as `postAs` with its line is left alone.
 * Every creative and new ad goes through the ledger; the swap is an idempotent update
 * under the run lock.
 */
export async function repointCopyTestAds(
  deps: { meta: CopyTestMeta; ledger: MetaWriteContext; record: CopyTestRecorders; lock: CopyTestLock },
  spec: CopyTestSpec,
  existing: readonly RepointRow[],
  postAs: PromoterIdentity,
): Promise<RepointResult> {
  const { meta, ledger, record } = deps;
  if (!meta.readAd || !meta.updateAd || !meta.archiveAd) throw new Error("repointCopyTestAds needs readAd, updateAd and archiveAd");
  if (!spec.identities.some((id) => id.pageId === postAs.pageId && id.instagramId === postAs.instagramId)) {
    throw new CopyTestStop(`Page ${postAs.pageId} / Instagram ${postAs.instagramId} isn't ${spec.eventCode}'s promoter or venue page, so nothing was made`);
  }
  if (!(await deps.lock.acquire())) throw new CopyTestStop(`Another run of ${spec.campaignName} is in progress, so this run made nothing`);
  try {
    const source = existing.some((row) => row.mode === "source") ? await meta.readCreative(spec.sourceCreativeId) : null;
    if (existing.some((row) => row.mode === "source") && !source) throw new CopyTestStop(`The source creative ${spec.sourceCreativeId} can't be read`);
    // Read and build everything before the first write, so a bad ad stops the run with nothing sent.
    const plans = [];
    for (const row of existing) {
      const live = await meta.readAd!(row.adId);
      if (!live?.creativeId) throw new CopyTestStop(`Ad ${row.adId} can't be read`);
      const current = await meta.readCreative(live.creativeId);
      if (!current) throw new CopyTestStop(`Ad ${row.adId}'s creative ${live.creativeId} can't be read`);
      let name: string;
      let message: string;
      let payload: Json;
      if (row.mode === "source") {
        const ad = spec.ads.find((a) => a.label === row.label);
        if (!ad || ad.kind !== "copy") throw new CopyTestStop(`${spec.campaignName} has no copy line ${row.label}`);
        name = ad.adName;
        message = ad.message;
        payload = copyTestCreativePayload(source!, { name, message, postAs });
      } else {
        name = live.name;
        message = creativeMessage(current) ?? "";
        if (!message) throw new CopyTestStop(`Ad ${row.adId}'s creative has no text to keep`);
        payload = copyTestCreativePayload(current, { name, message, postAs });
      }
      assertPromoterIdentity(spec.eventCode, payload, spec.identities);
      const now = creativeIdentity(current);
      const already = now.pageId === postAs.pageId && now.instagramId === postAs.instagramId && creativeMessage(current) === message && live.name === name;
      plans.push({ row, live, current, name, payload, already });
    }
    let writes = 0;
    const once = (opKind: Parameters<typeof withMetaWriteIdempotency>[1], key: unknown, run: () => Promise<string>) =>
      withMetaWriteIdempotency(ledger, opKind, key, async () => {
        writes += 1;
        return run();
      }, { required: true });
    const out: RepointResult["ads"] = [];
    for (const { row, live, name, payload, already } of plans) {
      if (already) {
        out.push({ label: row.label, adId: row.adId, creativeId: live.creativeId!, action: "already" });
        continue;
      }
      const key = row.mode === "source"
        ? { test: spec.campaignName, creative: row.label, source_creative_id: spec.sourceCreativeId, page: postAs.pageId }
        : { test: spec.campaignName, creative: row.label, identity_of: live.creativeId, page: postAs.pageId };
      const creativeId = await once("creative_upload", key, () => meta.createCreative(spec.adAccountId, payload));
      try {
        writes += 1;
        await meta.updateAd!(row.adId, { creative: { creative_id: creativeId }, name });
        await record.ad({ metaAdId: row.adId, metaCreativeId: creativeId, metaAdsetId: live.adsetId, metaCampaignId: live.campaignId, adName: name, creative: payload });
        out.push({ label: row.label, adId: row.adId, creativeId, action: "repointed" });
      } catch (refused) {
        await once("ad_status_update", { test: spec.campaignName, ad_id: row.adId, status: "ARCHIVED" }, async () => {
          await meta.archiveAd!(row.adId);
          return row.adId;
        });
        const adPayload = { name, adset_id: live.adsetId, creative: { creative_id: creativeId }, status: "PAUSED" };
        const newAdId = await once("ad_create", { test: spec.campaignName, ad: row.label, replaces: row.adId }, () => meta.createAd(spec.adAccountId, adPayload));
        await record.ad({ metaAdId: newAdId, metaCreativeId: creativeId, metaAdsetId: live.adsetId, metaCampaignId: live.campaignId, adName: name, creative: payload });
        await record.archivedAd?.({ metaAdId: row.adId, replacedBy: newAdId });
        out.push({ label: row.label, adId: newAdId, creativeId, action: "replaced", archivedAdId: row.adId });
        console.warn(`[copy-test] ${row.adId} couldn't take the new creative (${refused instanceof Error ? refused.message : String(refused)}); archived and replaced by ${newAdId}`);
      }
    }
    return { ads: out, writes };
  } finally {
    await deps.lock.release();
  }
}
