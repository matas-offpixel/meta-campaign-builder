import { createDefaultDraft } from "../../campaign-defaults.ts";
import { normalizeAdAccountId } from "../ad-account.ts";
import { resolveOptimisationGoal } from "../adset.ts";
import { mapMetaObjectiveToInternal } from "../campaign.ts";
import type {
  AdCreativeDraft,
  AdSetSuggestion,
  CampaignDraft,
  CustomAudienceGroup,
  InterestGroup,
  InterestSuggestion,
  LocationSelection,
  LocationTargetingGroup,
} from "../../types.ts";
import { deriveAssetSignature } from "../../reporting/asset-signature.ts";
import type { RawCreative } from "../../reporting/creative-preview-extract.ts";
import {
  assetsFromCreative,
  classifyImportedExistingPost,
  CTA_FROM_META,
  extractImportedCreativeCopy,
  IMPORTED_HEADLINE_ABSENT,
  importedExistingPostMedia,
  type ImportCreativeSource,
  type ImportedExistingPost,
} from "./creative-copy.ts";
import type {
  MetaImportDropped,
  MetaImportFlexibleSpec,
  MetaImportNotCarried,
  MetaLiveCampaignBundle,
} from "./types.ts";
import { META_IMPORT_UNCARRIABLE_TARGETING_FIELDS } from "./types.ts";

const HANDLED_TARGETING = new Set<string>([
  "age_min",
  "age_max",
  "geo_locations",
  "excluded_geo_locations",
  "custom_audiences",
  "flexible_spec",
  "interests",
  ...META_IMPORT_UNCARRIABLE_TARGETING_FIELDS,
]);

const HANDLED_GEO = new Set<string>([
  "cities",
  "countries",
  "regions",
  ...META_IMPORT_UNCARRIABLE_TARGETING_FIELDS,
]);

export type MetaAudienceAvailability = {
  id: string;
  available: boolean;
};

export type MapMetaLiveCampaignInput = {
  bundle: MetaLiveCampaignBundle;
  adAccountId: string;
  carry: readonly string[];
  /**
   * Ignored. An audience a live ad set on this account is targeting is
   * carried with the name the read returned. Changing the ad account
   * after import is blocked separately (`importedAccountProblem`).
   */
  availability: readonly MetaAudienceAvailability[];
  appUsageCallCount?: number | null;
  clientId?: string;
  eventId?: string;
  now?: string;
  /** `campaign_drafts.id` is a uuid. Defaults to a fresh one. */
  draftId?: string;
  /**
   * Width and height from one `GET /act_{id}/adimages?hashes=` read.
   * Used only for an image with no placement label. Absent sizes stay
   * Single and are named on `dropped`.
   */
  imageSizes?: Readonly<Record<string, { width: number; height: number }>>;
};

export const META_IMPORT_CARRY_KEY_REJECTED = "carry_key_rejected";

/** Creative ids the operator can carry: read, and with a resolvable asset. */
export function carriableMetaCreativeIds(bundle: MetaLiveCampaignBundle): Set<string> {
  const ids = new Set<string>();
  for (const [key, raw] of Object.entries(bundle.creatives)) {
    const creative = raw as RawCreative & { id?: string };
    const id = str(creative.id) ?? key;
    const source = { ...creative, id } as ImportCreativeSource;
    const existing = classifyImportedExistingPost(source);
    const postMedia = existing && !("unreachable" in existing) ? importedExistingPostMedia(source) : null;
    if (postMedia || (existing == null && deriveAssetSignature({ ...creative, id }))) {
      ids.add(id);
    }
  }
  return ids;
}

export function classifyMetaImportCarry(
  bundle: MetaLiveCampaignBundle,
  carry: readonly string[],
): { accepted: string[]; rejected: string[] } {
  const carriable = carriableMetaCreativeIds(bundle);
  return {
    accepted: carry.filter((key) => carriable.has(key)),
    rejected: carry.filter((key) => !carriable.has(key)),
  };
}

export function formatRejectedMetaCarryKeys(rejected: readonly string[]): string {
  return `Nothing was saved. Rejected keys: ${rejected.join(", ")}.`;
}

type CitySpec = {
  key: string;
  name: string;
  radius?: number;
  distanceUnit?: "kilometer" | "mile";
  countryCode?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function dateOnly(value: unknown): string {
  const raw = str(value);
  return raw ? raw.slice(0, 10) : "";
}

function drop(
  dropped: MetaImportDropped[],
  field: string,
  value: unknown,
  ctx: { adSetId?: string; adSetName?: string; creativeId?: string } = {},
) {
  dropped.push({ field, value, ...ctx });
}

function dropUncarriable(
  dropped: MetaImportDropped[],
  source: Record<string, unknown> | null,
  ctx: { adSetId?: string; adSetName?: string },
) {
  if (!source) return;
  for (const field of META_IMPORT_UNCARRIABLE_TARGETING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      drop(dropped, field, source[field], ctx);
    }
  }
}

function dropUnknown(
  dropped: MetaImportDropped[],
  source: Record<string, unknown> | null,
  handled: ReadonlySet<string>,
  ctx: { adSetId?: string; adSetName?: string },
) {
  if (!source) return;
  for (const key of Object.keys(source)) {
    if (!handled.has(key)) drop(dropped, key, source[key], ctx);
  }
}

function cityFrom(raw: unknown, dropped: MetaImportDropped[], ctx: { adSetId?: string; adSetName?: string }): CitySpec | null {
  const row = asRecord(raw);
  if (!row) {
    drop(dropped, "cities", raw, ctx);
    return null;
  }
  const key = str(row.key);
  if (!key) {
    drop(dropped, "cities", raw, ctx);
    return null;
  }
  const unit = str(row.distance_unit);
  const distanceUnit = unit === "kilometer" || unit === "mile" ? unit : undefined;
  if (unit && !distanceUnit) drop(dropped, "distance_unit", unit, ctx);
  return {
    key,
    name: str(row.name) ?? key,
    radius: num(row.radius) ?? undefined,
    distanceUnit,
    countryCode: str(row.country) ?? undefined,
  };
}

function cityGroupId(city: CitySpec): string {
  return `city:${city.key}:${city.radius ?? ""}:${city.distanceUnit ?? ""}`;
}

function selectionForCity(city: CitySpec, id: string): LocationSelection {
  return {
    id,
    source: "search",
    label: city.name,
    mode: "include",
    locationType: "city",
    locationKey: city.key,
    countryCode: city.countryCode,
    radius: city.radius,
    distanceUnit: city.distanceUnit,
  };
}

function countrySelection(code: string, id: string, mode: "include" | "exclude"): LocationSelection {
  return {
    id,
    source: "search",
    label: code,
    mode,
    locationType: "country",
    countryCode: code,
  };
}

function regionSelection(
  key: string,
  name: string,
  id: string,
  mode: "include" | "exclude",
): LocationSelection {
  return {
    id,
    source: "search",
    label: name,
    mode,
    locationType: "region",
    locationKey: key,
  };
}

type GeoBucket = {
  groups: Map<string, LocationTargetingGroup>;
  pool: Map<string, LocationSelection>;
};

function ensureGroup(bucket: GeoBucket, id: string, label: string, selection: LocationSelection) {
  if (!bucket.groups.has(id)) {
    bucket.groups.set(id, { id, label, source: "manual", selections: [{ ...selection, mode: "include" }] });
  }
}

function readGeo(
  geo: Record<string, unknown> | null,
  bucket: GeoBucket,
  dropped: MetaImportDropped[],
  ctx: { adSetId?: string; adSetName?: string },
  mode: "include" | "exclude",
): string[] {
  if (!geo) return [];
  dropUncarriable(dropped, geo, ctx);
  dropUnknown(dropped, geo, HANDLED_GEO, ctx);
  const ids: string[] = [];

  for (const raw of Array.isArray(geo.cities) ? geo.cities : []) {
    const city = cityFrom(raw, dropped, ctx);
    if (!city) continue;
    const id = `${mode === "exclude" ? "excl:" : ""}${cityGroupId(city)}`;
    if (mode === "include") {
      ensureGroup(bucket, id, city.name, selectionForCity(city, id));
    } else if (!bucket.pool.has(id)) {
      bucket.pool.set(id, { ...selectionForCity(city, id), mode: "exclude" });
    }
    ids.push(id);
  }

  for (const raw of Array.isArray(geo.countries) ? geo.countries : []) {
    const code = str(raw);
    if (!code) {
      drop(dropped, "countries", raw, ctx);
      continue;
    }
    const id = `${mode === "exclude" ? "excl:" : ""}country:${code}`;
    if (mode === "include") {
      ensureGroup(bucket, id, code, countrySelection(code, id, "include"));
    } else if (!bucket.pool.has(id)) {
      bucket.pool.set(id, countrySelection(code, id, "exclude"));
    }
    ids.push(id);
  }

  for (const raw of Array.isArray(geo.regions) ? geo.regions : []) {
    const row = asRecord(raw);
    const key = str(row?.key);
    if (!key) {
      drop(dropped, "regions", raw, ctx);
      continue;
    }
    const name = str(row?.name) ?? key;
    const id = `${mode === "exclude" ? "excl:" : ""}region:${key}`;
    if (mode === "include") {
      ensureGroup(bucket, id, name, regionSelection(key, name, id, "include"));
    } else if (!bucket.pool.has(id)) {
      bucket.pool.set(id, regionSelection(key, name, id, "exclude"));
    }
    ids.push(id);
  }

  return ids;
}

function flexibleSpecOf(
  targeting: Record<string, unknown>,
): MetaImportFlexibleSpec {
  if (!Object.prototype.hasOwnProperty.call(targeting, "flexible_spec")) {
    return { state: "absent", interestIds: [] };
  }
  const raw = targeting.flexible_spec;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { state: "empty", interestIds: [] };
  }
  const interestIds: string[] = [];
  for (const block of raw) {
    const interests = asRecord(block)?.interests;
    if (!Array.isArray(interests)) continue;
    for (const interest of interests) {
      const id = str(asRecord(interest)?.id);
      if (id) interestIds.push(id);
    }
  }
  return { state: "present", interestIds };
}

function interestSuggestions(
  targeting: Record<string, unknown>,
  flexible: MetaImportFlexibleSpec,
  dropped: MetaImportDropped[],
  ctx: { adSetId?: string; adSetName?: string },
): InterestSuggestion[] {
  const out: InterestSuggestion[] = [];
  const seen = new Set<string>();
  const take = (raw: unknown) => {
    const row = asRecord(raw);
    const id = str(row?.id);
    if (!id) {
      if (raw != null) drop(dropped, "interests", raw, ctx);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: str(row?.name) ?? id, source: "search" });
  };

  if (flexible.state === "present" && Array.isArray(targeting.flexible_spec)) {
    for (const block of targeting.flexible_spec) {
      const record = asRecord(block);
      if (!record) {
        drop(dropped, "flexible_spec", block, ctx);
        continue;
      }
      for (const key of Object.keys(record)) {
        if (key !== "interests") drop(dropped, key, record[key], ctx);
      }
      const interests = record.interests;
      if (Array.isArray(interests)) interests.forEach(take);
    }
  }
  if (Array.isArray(targeting.interests)) targeting.interests.forEach(take);
  return out;
}

function creativeDraft(
  creative: RawCreative & { id: string },
  dropped: MetaImportDropped[],
  imageSizes: Readonly<Record<string, { width: number; height: number }>>,
  headlineNotes: { creativeId: string; text: string }[],
): AdCreativeDraft | null {
  const signature = deriveAssetSignature(creative);
  if (!signature) return null;
  const source = creative as ImportCreativeSource;
  const built = assetsFromCreative(source, imageSizes);
  if (!built) return null;
  const copy = extractImportedCreativeCopy(source);
  for (const row of copy.dropped) {
    drop(dropped, row.field, row.value, { creativeId: creative.id });
  }
  if (built.aspectUnrecorded) {
    drop(dropped, "aspect_ratio", "not_recorded", { creativeId: creative.id });
  }
  if (copy.headlineAbsent) {
    headlineNotes.push({ creativeId: creative.id, text: IMPORTED_HEADLINE_ABSENT });
  }
  const oss = source.object_story_spec;
  return {
    id: creative.id,
    name: str(creative.name) ?? creative.id,
    sourceType: "new",
    identity: {
      pageId: str(oss?.page_id) ?? "",
      instagramAccountId: str(oss?.instagram_user_id) ?? "",
    },
    mediaType: built.mediaType,
    assetMode: built.assetMode,
    assetVariations: [{ id: `var:${creative.id}`, name: "Imported", assets: built.assets }],
    captions: (copy.captions.length > 0 ? copy.captions : [""]).map((text, index) => ({
      id: `cap:${creative.id}:${index}`,
      text,
    })),
    headline: copy.headline,
    description: copy.description,
    destinationUrl: copy.destinationUrl,
    cta: copy.cta || ("" as AdCreativeDraft["cta"]),
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
    metaCreativeId: creative.id,
  };
}

function existingPostDraft(
  creative: RawCreative & { id: string },
  post: ImportedExistingPost,
  mediaType: "video" | "image",
  dropped: MetaImportDropped[],
): AdCreativeDraft {
  const source = creative as ImportCreativeSource;
  const linkFromCta = source.call_to_action?.value?.link?.trim() ?? "";
  const rawCta = (source.call_to_action?.type || source.call_to_action_type || "").trim().toUpperCase();
  const mapped = rawCta ? CTA_FROM_META[rawCta] : undefined;
  if (rawCta && !mapped) {
    drop(dropped, "call_to_action_type", rawCta, { creativeId: creative.id });
  }
  const mediaKind = mediaType === "video" ? "video" : undefined;
  if (!mediaKind) {
    drop(dropped, "media_kind", "not_recorded", { creativeId: creative.id });
  }
  return {
    id: creative.id,
    name: str(creative.name) ?? creative.id,
    sourceType: "existing_post",
    identity: {
      pageId: post.pageId,
      instagramAccountId: post.instagramAccountId ?? "",
    },
    mediaType,
    assetMode: "single",
    assetVariations: [],
    captions: [],
    headline: "",
    description: "",
    destinationUrl: linkFromCta || (str(source.link_url) ?? ""),
    cta: mapped ?? ("" as AdCreativeDraft["cta"]),
    existingPost: {
      source: post.source,
      postId: post.postId,
      instagramAccountId: post.instagramAccountId,
      mediaKind,
    },
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
    metaCreativeId: creative.id,
  };
}

/**
 * Map a live Meta campaign onto a `CampaignDraft`. Targeting the draft
 * cannot represent is named on `importMeta.dropped` and never defaulted.
 * Does not call Meta.
 */
export function mapMetaLiveCampaign(input: MapMetaLiveCampaignInput): CampaignDraft {
  const campaign = input.bundle.campaign;
  const rawObjective = str(campaign.objective);
  const objective = mapMetaObjectiveToInternal(rawObjective);
  if (!objective) {
    throw new Error(
      `Meta import refused: objective ${rawObjective ?? "(missing)"} is not supported`,
    );
  }

  const now = input.now ?? new Date().toISOString();
  const account = normalizeAdAccountId(input.adAccountId) ?? input.adAccountId;
  const dropped: MetaImportDropped[] = [];
  const notCarried: MetaImportNotCarried[] = [];
  const flexibleSpec: Record<string, MetaImportFlexibleSpec> = {};
  const bucket: GeoBucket = { groups: new Map(), pool: new Map() };
  const carry = new Set(input.carry);
  const optimisationGoal = resolveOptimisationGoal("conversions", objective);

  const interestGroups = new Map<string, InterestGroup>();
  const customGroups = new Map<string, CustomAudienceGroup>();
  const adSets: AdSetSuggestion[] = [];
  const assignments: Record<string, string[]> = {};

  for (const raw of input.bundle.adSets) {
    const id = str(raw.id) ?? "";
    const name = str(raw.name) ?? id;
    const ctx = { adSetId: id, adSetName: name };
    const targeting = asRecord(raw.targeting) ?? {};
    dropUncarriable(dropped, targeting, ctx);
    dropUncarriable(dropped, raw, ctx);
    dropUnknown(dropped, targeting, HANDLED_TARGETING, ctx);

    if (Object.prototype.hasOwnProperty.call(raw, "optimization_goal")) {
      drop(dropped, "optimization_goal", raw.optimization_goal, ctx);
    }
    if (Object.prototype.hasOwnProperty.call(raw, "promoted_object")) {
      drop(dropped, "promoted_object", raw.promoted_object, ctx);
    }

    const flexible = flexibleSpecOf(targeting);
    flexibleSpec[id] = flexible;
    const interests = interestSuggestions(targeting, flexible, dropped, ctx);
    let interestGroupId = "";
    if (interests.length > 0) {
      const key = interests.map((item) => item.id).sort().join(",");
      interestGroupId = `interests:${key}`;
      if (!interestGroups.has(interestGroupId)) {
        interestGroups.set(interestGroupId, {
          id: interestGroupId,
          name: interests.map((item) => item.name).join(", ").slice(0, 80),
          interests,
        });
      }
    }

    const availableIds: string[] = [];
    const audienceNames: Record<string, string> = {};
    for (const rawAudience of Array.isArray(targeting.custom_audiences) ? targeting.custom_audiences : []) {
      const row = asRecord(rawAudience);
      const audienceId = str(row?.id);
      if (!audienceId) {
        drop(dropped, "custom_audiences", rawAudience, ctx);
        continue;
      }
      // A live ad set on this account is already targeting this audience.
      // That is the availability proof. The account's custom-audience list
      // misses audiences shared in from another Business Manager.
      availableIds.push(audienceId);
      const audienceName = str(row?.name);
      if (audienceName) audienceNames[audienceId] = audienceName;
    }

    let customGroupId = "";
    if (availableIds.length > 0) {
      customGroupId = `custom:${id}`;
      customGroups.set(customGroupId, {
        id: customGroupId,
        name: name,
        audienceIds: [...availableIds].sort(),
        audienceNames,
      });
    }

    if (interestGroupId && customGroupId) {
      drop(dropped, "interests", interests.map((item) => item.id), ctx);
    }

    const geo = asRecord(targeting.geo_locations);
    const locationGroupIds = readGeo(geo, bucket, dropped, ctx, "include");
    const excludedLocationIds = readGeo(
      asRecord(targeting.excluded_geo_locations),
      bucket,
      dropped,
      ctx,
      "exclude",
    );

    const ageMin = num(targeting.age_min);
    const ageMax = num(targeting.age_max);
    if (ageMin == null) drop(dropped, "age_min", targeting.age_min ?? null, ctx);
    if (ageMax == null) drop(dropped, "age_max", targeting.age_max ?? null, ctx);
    const daily = num(raw.daily_budget);
    if (daily == null) drop(dropped, "daily_budget", raw.daily_budget ?? null, ctx);

    const automation = asRecord(targeting.targeting_automation);
    const advantagePlus = automation?.advantage_audience === 1;

    const sourceType = customGroupId
      ? "custom_group"
      : interestGroupId
        ? "interest_group"
        : "blank";
    const sourceId = customGroupId || interestGroupId;

    const suggestion: AdSetSuggestion = {
      id,
      name,
      sourceType,
      sourceId,
      sourceName: name,
      ageMin: ageMin ?? Number.NaN,
      ageMax: ageMax ?? Number.NaN,
      budgetPerDay: daily == null ? Number.NaN : daily / 100,
      advantagePlus,
      enabled: raw.status === "ACTIVE",
      locationGroupIds,
      excludedLocationIds,
      importedFromAdSetId: id,
    };
    adSets.push(suggestion);
    assignments[id] = [];
  }

  const creatives: AdCreativeDraft[] = [];
  const headlineNotes: { creativeId: string; text: string }[] = [];
  const creativeIds = Object.keys(input.bundle.creatives);
  for (const creativeId of creativeIds) {
    const creative = input.bundle.creatives[creativeId] as RawCreative & { id?: string };
    const id = str(creative.id) ?? creativeId;
    const named = { ...creative, id };
    const existing = classifyImportedExistingPost(named as ImportCreativeSource);
    if (existing) {
      const name = str(named.name) ?? id;
      if ("unreachable" in existing) {
        notCarried.push({ id, name, reason: "post_unreachable" });
        continue;
      }
      const mediaType = importedExistingPostMedia(named as ImportCreativeSource);
      if (!mediaType) {
        notCarried.push({ id, name, reason: "no_media_reported" });
        continue;
      }
      if (!carry.has(id)) {
        notCarried.push({ id, name, reason: "operator_unticked" });
        continue;
      }
      creatives.push(existingPostDraft(named, existing, mediaType, dropped));
      continue;
    }
    const signature = deriveAssetSignature(named);
    if (!signature) {
      notCarried.push({
        id,
        name: str(named.name) ?? id,
        reason: "no_asset_reported",
      });
      continue;
    }
    if (!carry.has(id)) {
      notCarried.push({
        id,
        name: str(named.name) ?? id,
        reason: "operator_unticked",
      });
      continue;
    }
    const draftCreative = creativeDraft(named, dropped, input.imageSizes ?? {}, headlineNotes);
    if (!draftCreative) continue;
    creatives.push(draftCreative);
  }

  const readIds = new Set(
    creativeIds.map((key) => str((input.bundle.creatives[key] as { id?: unknown }).id) ?? key),
  );
  for (const key of carry) {
    if (readIds.has(key)) continue;
    notCarried.push({ id: key, name: key, reason: META_IMPORT_CARRY_KEY_REJECTED });
  }

  const carriedIds = new Set(creatives.map((creative) => creative.id));
  for (const ad of input.bundle.ads) {
    const adSetId = str(ad.adset_id);
    const creative = asRecord(ad.creative);
    const creativeId = str(creative?.id);
    if (!adSetId || !creativeId || !carriedIds.has(creativeId)) continue;
    const list = assignments[adSetId];
    if (list && !list.includes(creativeId)) list.push(creativeId);
  }

  const draft = createDefaultDraft();
  const dailyTotal = adSets.reduce(
    (sum, adSet) => sum + (Number.isFinite(adSet.budgetPerDay) ? adSet.budgetPerDay : 0),
    0,
  );
  draft.id = input.draftId ?? globalThis.crypto.randomUUID();
  draft.settings.clientId = input.clientId ?? "";
  draft.settings.eventId = input.eventId ?? "";
  draft.settings.adAccountId = account;
  draft.settings.metaAdAccountId = account;
  draft.settings.campaignName = str(campaign.name) ?? "";
  draft.settings.objective = objective;
  draft.settings.optimisationGoal = optimisationGoal;
  draft.settings.wizardMode = "new";
  draft.audiences.interestGroups = [...interestGroups.values()];
  draft.audiences.customAudienceGroups = [...customGroups.values()];
  draft.budgetSchedule.budgetLevel = "ad_set";
  draft.budgetSchedule.budgetType = "daily";
  draft.budgetSchedule.budgetAmount = dailyTotal;
  draft.budgetSchedule.startDate = dateOnly(campaign.start_time);
  draft.budgetSchedule.endDate = dateOnly(campaign.stop_time);
  draft.budgetSchedule.locationGroups = [...bucket.groups.values()];
  draft.budgetSchedule.excludedLocations = [...bucket.pool.values()];
  draft.adSetSuggestions = adSets;
  draft.creatives = creatives;
  draft.creativeAssignments = assignments;
  draft.createdAt = now;
  draft.updatedAt = now;
  draft.importMeta = {
    sourceCampaignId: str(campaign.id) ?? "",
    sourceCampaignName: str(campaign.name) ?? "",
    sourceAdAccountId: account,
    dropped,
    notCarried,
    creativeCounts: {
      read: creativeIds.length,
      carried: creatives.length,
      notCarried: notCarried.filter(
        (row) => row.reason === "no_asset_reported" || row.reason === "operator_unticked",
      ).length,
    },
    flexibleSpec,
    appUsageCallCount: input.appUsageCallCount ?? null,
    copyNotes: headlineNotes,
  };
  return draft;
}

export function parseMetaImportCarry(body: {
  carry?: unknown;
}):
  | { action: "picker" }
  | { action: "nosave" }
  | { action: "save"; carry: string[] } {
  if (!Object.prototype.hasOwnProperty.call(body, "carry")) return { action: "picker" };
  if (!Array.isArray(body.carry)) return { action: "nosave" };
  const carry = body.carry
    .filter((key): key is string => typeof key === "string" && Boolean(key.trim()))
    .map((key) => key.trim());
  if (carry.length === 0) return { action: "nosave" };
  return { action: "save", carry };
}
