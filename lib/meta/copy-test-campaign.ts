/**
 * A copy test in its own campaign (the A/B copy test, #1285; Matas's rulings of 17 Nov).
 *
 * Since Matas's rules of 17 Nov (second set), one test campaign per show,
 * "{code} · Tests" (lib/creative-tests/tests-campaign.ts), holding every test as
 * its own ad set with its own daily budget; created ACTIVE unless asked paused.
 * The 17 Nov round below was made as one campaign per test and stays so.
 *
 * Originally, one small campaign per test, holding one ad set:
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

import { findTestsCampaign, testsCampaignPayload, TestsCampaignProblem, type CampaignRow } from "../creative-tests/tests-campaign.ts";
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

/** What the copy keeps from its source ad set, besides targeting and the promoted object. */
export const COPIED_ADSET_FIELDS = ["optimization_goal", "billing_event", "attribution_spec", "destination_type", "adset_schedule"] as const;

/**
 * The ad set copy: its source as it stands (targeting, goal, promoted object), in the
 * show's Tests campaign, carrying the test's own daily budget (minor units, as given)
 * at lowest cost, ending at `endTime`, ACTIVE unless created paused. The campaign never
 * holds a budget, so Meta can't move money between tests. `smart_pse_enabled` is
 * Meta's read-back default and is left off the write.
 */
export function copyTestAdSetPayload(src: Json, args: { campaignId: string; name: string; endTime: string; dailyMinor: number; status: "ACTIVE" | "PAUSED" }): Json {
  if (!Number.isInteger(args.dailyMinor) || args.dailyMinor <= 0) throw new Error(`The daily budget must be a whole number of pence (got ${args.dailyMinor})`);
  if (!src.targeting || typeof src.targeting !== "object") throw new Error("The source ad set has no targeting to copy");
  if (!src.promoted_object || typeof src.promoted_object !== "object") throw new Error("The source ad set has no promoted object to copy");
  const promoted: Json = { ...(src.promoted_object as Json) };
  delete promoted.smart_pse_enabled;
  const payload: Json = {
    name: args.name,
    campaign_id: args.campaignId,
    status: args.status,
    daily_budget: args.dailyMinor,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
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
  /** The show's test campaign, "{code} · Tests" (testsCampaignName). The 17 Nov round used one campaign per test. */
  campaignName: string;
  adSetName: string;
  adAccountId: string;
  /** The campaign's daily budget, minor units, as ruled. */
  dailyMinor: number;
  sourceAdSetId: string;
  sourceCreativeId: string;
  ads: CopyTestAdSpec[];
  /** ACTIVE (the default since 17 Nov) or PAUSED, for the ad set and its ads. A found Tests campaign keeps its own status. */
  status?: "ACTIVE" | "PAUSED";
  /** The show's promoter/venue page + Instagram pairs (promoterIdentities). A creative on anything else is refused. */
  identities: PromoterIdentity[];
};

export type CopyTestMeta = {
  readAdSet(adsetId: string): Promise<Json | null>;
  readCreative(creativeId: string): Promise<Json | null>;
  /** The ad account's min_daily_budget, minor units, or null when it can't be read. */
  readMinDailyBudget(adAccountId: string): Promise<number | null>;
  /** The ad account's campaigns whose name contains the event code (id, name, status, budgets), for findTestsCampaign. */
  listCampaigns?(adAccountId: string, eventCode: string): Promise<CampaignRow[]>;
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

/**
 * Matas, 17 Nov: Kream's support-act cards are no longer a promoter test. Each card
 * runs from that artist's own page with the artist's own copy. This is the only place
 * an artist page is allowed: these page ids, in this campaign. Every other test still
 * refuses artist pages.
 */
export const ARTIST_CARD_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  // EBR26-KREAM · Artist cards test: Estiva, Leena Punks, PARTS.
  "120250552886550716": ["71896176954", "1543580149233320", "877729655689651"],
};

/** The artist identities a campaign may post as (each page with its own linked Instagram); none outside ARTIST_CARD_EXCEPTIONS. */
export function artistCardIdentities(campaignId: string, pages: readonly PageFacts[]): PromoterIdentity[] {
  const allowed = ARTIST_CARD_EXCEPTIONS[campaignId] ?? [];
  return pages.filter((page) => allowed.includes(page.id) && page.linkedInstagramId).map((page) => ({ pageId: page.id, instagramId: page.linkedInstagramId! }));
}

/** Meta writes for a test: the Tests campaign (only when the show has none yet), the ad set, and per ad a creative and an ad (plus an image upload per card). */
export function copyTestWriteCount(spec: Pick<CopyTestSpec, "ads">, opts: { campaignExists: boolean } = { campaignExists: false }): number {
  return (opts.campaignExists ? 0 : 1) + 1 + spec.ads.reduce((sum, ad) => sum + (ad.kind === "card" ? 3 : 2), 0);
}

/**
 * Makes one test, in order: the show's Tests campaign (found by exact name, else made
 * once with no budget), the test's ad set with its own daily budget, then per ad
 * (image), creative, ad, all ACTIVE unless spec.status is PAUSED. A failed step throws;
 * a rerun picks up from the ledger. The budget is checked against the account's minimum
 * before any write.
 */
export async function createCopyTest(
  deps: { meta: CopyTestMeta; ledger: MetaWriteContext; record: CopyTestRecorders; lock: CopyTestLock; now?: Date },
  spec: CopyTestSpec,
): Promise<CopyTestResult> {
  if (!(await deps.lock.acquire())) throw new CopyTestStop(`Another run of ${spec.adSetName} is in progress, so this run made nothing`);
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

  if (!meta.listCampaigns) throw new Error("createCopyTest needs listCampaigns to find the show's Tests campaign");
  const status = spec.status ?? "ACTIVE";
  let existing: CampaignRow | null;
  try {
    existing = findTestsCampaign(await meta.listCampaigns(spec.adAccountId, spec.eventCode), spec.eventCode);
  } catch (err) {
    if (err instanceof TestsCampaignProblem) throw new CopyTestStop(err.message);
    throw err;
  }
  // A copy test only ever goes in the show's "{code} · Tests" (the 17 Nov round's per-test campaigns can't be created again).
  if (spec.campaignName !== testsCampaignPayload(spec.eventCode, { status }).name) {
    throw new CopyTestStop(`${spec.campaignName} isn't ${spec.eventCode}'s Tests campaign name, so nothing was made`);
  }

  const { day: endDay, endTime } = copyTestEndTime(deps.now ?? new Date());
  // Build every payload before the first write, so a bad source stops the test with nothing made.
  const campaignPayload = testsCampaignPayload(spec.eventCode, { status });
  copyTestAdSetPayload(source, { campaignId: "0", name: spec.adSetName, endTime, dailyMinor: spec.dailyMinor, status });
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

  // The show's Tests campaign: reused by exact name on the account, else made once (no campaign budget).
  // The ledger keys name the step, not the payload: an ad set or an ad is made once per test, whatever the end time.
  const campaignId = existing?.id ?? (await once("campaign_create", { tests_campaign: campaignPayload.name, ad_account: spec.adAccountId }, () => meta.createCampaign(spec.adAccountId, campaignPayload)));
  const adSetPayload = copyTestAdSetPayload(source, { campaignId, name: spec.adSetName, endTime, dailyMinor: spec.dailyMinor, status });
  const adSetId = await once("adset_create", { test: spec.adSetName, source_adset_id: spec.sourceAdSetId }, () => meta.createAdSet(spec.adAccountId, adSetPayload));
  await record.adSet({ metaAdsetId: adSetId, metaCampaignId: campaignId, source, dailyMinor: spec.dailyMinor });

  const ads: CopyTestResult["ads"] = [];
  for (const ad of spec.ads) {
    let imageHash: string | undefined;
    let payload: Json;
    if (ad.kind === "card") {
      imageHash = await once("creative_upload", { test: spec.adSetName, image: ad.image.fileName }, () => meta.uploadImage(spec.adAccountId, ad.image));
      payload = copyTestCardPayload(creative, { name: ad.adName, message: ad.message, imageHash });
    } else {
      payload = copyTestCreativePayload(creative, { name: ad.adName, message: ad.message });
    }
    const creativeId = await once("creative_upload", { test: spec.adSetName, creative: ad.label }, () => meta.createCreative(spec.adAccountId, payload));
    const adPayload = { name: ad.adName, adset_id: adSetId, creative: { creative_id: creativeId }, status };
    const adId = await once("ad_create", { test: spec.adSetName, ad: ad.label }, () => meta.createAd(spec.adAccountId, adPayload));
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
export type RepointRow = {
  label: string;
  adId: string;
  mode: "source" | "identity";
  /** This ad's own page and Instagram, when it differs from the test's (an artist card). */
  postAs?: PromoterIdentity;
  /** Text used exactly, in place of the ad's own (an artist's copy). */
  message?: string;
};

function artistExceptionPage(pageId: string): boolean {
  return Object.values(ARTIST_CARD_EXCEPTIONS).some((pages) => pages.includes(pageId));
}

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
  for (const target of [postAs, ...existing.flatMap((row) => (row.postAs ? [row.postAs] : []))]) {
    if (!spec.identities.some((id) => id.pageId === target.pageId && id.instagramId === target.instagramId)) {
      throw new CopyTestStop(`Page ${target.pageId} / Instagram ${target.instagramId} isn't allowed for ${spec.adSetName}, so nothing was made`);
    }
  }
  if (!(await deps.lock.acquire())) throw new CopyTestStop(`Another run of ${spec.adSetName} is in progress, so this run made nothing`);
  try {
    const source = existing.some((row) => row.mode === "source") ? await meta.readCreative(spec.sourceCreativeId) : null;
    if (existing.some((row) => row.mode === "source") && !source) throw new CopyTestStop(`The source creative ${spec.sourceCreativeId} can't be read`);
    // Read and build everything before the first write, so a bad ad stops the run with nothing sent.
    const plans = [];
    for (const row of existing) {
      const rowAs = row.postAs ?? postAs;
      const live = await meta.readAd!(row.adId);
      if (!live?.creativeId) throw new CopyTestStop(`Ad ${row.adId} can't be read`);
      if (artistExceptionPage(rowAs.pageId) && !(ARTIST_CARD_EXCEPTIONS[live.campaignId] ?? []).includes(rowAs.pageId)) {
        throw new CopyTestStop(`Ad ${row.adId} is in campaign ${live.campaignId}, where artist page ${rowAs.pageId} isn't allowed, so nothing was made`);
      }
      const current = await meta.readCreative(live.creativeId);
      if (!current) throw new CopyTestStop(`Ad ${row.adId}'s creative ${live.creativeId} can't be read`);
      let name: string;
      let message: string;
      let payload: Json;
      if (row.mode === "source") {
        const ad = spec.ads.find((a) => a.label === row.label);
        if (!ad || ad.kind !== "copy") throw new CopyTestStop(`${spec.adSetName} has no copy line ${row.label}`);
        name = ad.adName;
        message = row.message ?? ad.message;
        payload = copyTestCreativePayload(source!, { name, message, postAs: rowAs });
      } else {
        name = live.name;
        message = row.message ?? creativeMessage(current) ?? "";
        if (!message) throw new CopyTestStop(`Ad ${row.adId}'s creative has no text to keep`);
        payload = copyTestCreativePayload(current, { name, message, postAs: rowAs });
      }
      assertPromoterIdentity(spec.eventCode, payload, spec.identities);
      const now = creativeIdentity(current);
      const already = now.pageId === rowAs.pageId && now.instagramId === rowAs.instagramId && creativeMessage(current) === message && live.name === name;
      plans.push({ row, rowAs, live, current, name, payload, already });
    }
    let writes = 0;
    const once = (opKind: Parameters<typeof withMetaWriteIdempotency>[1], key: unknown, run: () => Promise<string>) =>
      withMetaWriteIdempotency(ledger, opKind, key, async () => {
        writes += 1;
        return run();
      }, { required: true });
    const out: RepointResult["ads"] = [];
    for (const { row, rowAs, live, name, payload, already } of plans) {
      if (already) {
        out.push({ label: row.label, adId: row.adId, creativeId: live.creativeId!, action: "already" });
        continue;
      }
      const key = row.mode === "source"
        ? { test: spec.adSetName, creative: row.label, source_creative_id: spec.sourceCreativeId, page: rowAs.pageId }
        : { test: spec.adSetName, creative: row.label, identity_of: live.creativeId, page: rowAs.pageId, ...(row.message ? { message: row.message } : {}) };
      const creativeId = await once("creative_upload", key, () => meta.createCreative(spec.adAccountId, payload));
      try {
        writes += 1;
        await meta.updateAd!(row.adId, { creative: { creative_id: creativeId }, name });
        await record.ad({ metaAdId: row.adId, metaCreativeId: creativeId, metaAdsetId: live.adsetId, metaCampaignId: live.campaignId, adName: name, creative: payload });
        out.push({ label: row.label, adId: row.adId, creativeId, action: "repointed" });
      } catch (refused) {
        await once("ad_status_update", { test: spec.adSetName, ad_id: row.adId, status: "ARCHIVED" }, async () => {
          await meta.archiveAd!(row.adId);
          return row.adId;
        });
        const adPayload = { name, adset_id: live.adsetId, creative: { creative_id: creativeId }, status: "PAUSED" };
        const newAdId = await once("ad_create", { test: spec.adSetName, ad: row.label, replaces: row.adId }, () => meta.createAd(spec.adAccountId, adPayload));
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
