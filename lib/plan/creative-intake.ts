/**
 * MML ② creative intake — pure sort, Match rules, and the send plan.
 *
 * Pixels decide the column. `snapRatio` buckets them. A filename hint
 * (`parseAspectFromFilename`) is used only when two standard ratios are
 * equally close; a measured ratio always beats the filename, and a file
 * with no readable dimensions stays in Other.
 *
 * Match builds the existing AssetMode values (single / dual / full). It
 * does not invent a creative shape. Send keys every creative by a stable
 * group id and never rewrites a creative the operator edited in a drawer.
 */

import {
  parseAspectFromFilename,
  snapRatio,
  type StandardAspect,
} from "../clients/asset-queue/aspect-detect.ts";
import { TIKTOK_LAUNCHED_UNROUTE_NOTE } from "./asset-routing.ts";
import type { RegistryAspect, RegistryMediaKind } from "../creatives/asset-registry.ts";
import type { AssetMode } from "../types.ts";

export const INTAKE_BUCKETS = ["4:5", "1:1", "9:16", "other"] as const;
export type IntakeBucket = (typeof INTAKE_BUCKETS)[number];

export const META_CROSS_PUBLISH_NOTE =
  "Meta will cross-publish one asset (the legacy path).";

export const META_LAUNCHED_UNROUTE_NOTE =
  "This plan's Meta campaign is already launched — removing it here will not delete the live ad.";

/** Same gate `buildMultiPlacementCreative` reads. Anything else is the legacy path. */
export function isMultiPlacementEnabled(flag: string | undefined): boolean {
  return flag === "1";
}

export interface IntakeAspect {
  bucket: IntakeBucket;
  /** `filename-tiebreak` only when two measured ratios are equally close. */
  source: "pixels" | "filename-tiebreak" | "unreadable";
  reason: string | null;
}

const TIE_EPSILON = 1e-6;

/**
 * Relative distance to each standard ratio. A tie is two ratios inside
 * snapRatio's tolerance and equally close — the only time the filename
 * may choose.
 */
export function tiedStandardAspects(width: number, height: number): StandardAspect[] | null {
  if (width <= 0 || height <= 0) return null;
  const ratio = width / height;
  const scored = (
    [
      ["1:1", 1],
      ["4:5", 4 / 5],
      ["9:16", 9 / 16],
    ] as const
  ).map(([aspect, value]) => ({
    aspect,
    error: Math.abs(ratio - value) / value,
  }));
  const within = scored.filter((row) => row.error <= 0.05);
  if (within.length < 2) return null;
  const best = Math.min(...within.map((row) => row.error));
  const tied = within.filter((row) => Math.abs(row.error - best) <= TIE_EPSILON);
  return tied.length >= 2 ? tied.map((row) => row.aspect) : null;
}

/** Filename may choose only among ratios the measurement could not separate. */
export function bucketFromMeasurement(input: {
  width: number;
  height: number;
  snapped: ReturnType<typeof snapRatio>;
  tied: StandardAspect[] | null;
  filenameHint: StandardAspect | null;
}): IntakeAspect {
  if (input.tied && input.filenameHint && input.tied.includes(input.filenameHint)) {
    return { bucket: input.filenameHint, source: "filename-tiebreak", reason: null };
  }
  if (input.snapped === "other") {
    return {
      bucket: "other",
      source: "pixels",
      reason: `${input.width}×${input.height} is not 4:5, 1:1 or 9:16`,
    };
  }
  return { bucket: input.snapped, source: "pixels", reason: null };
}

export function intakeAspect(input: {
  width: number | null;
  height: number | null;
  filename: string;
}): IntakeAspect {
  const width = input.width;
  const height = input.height;
  if (width == null || height == null || width <= 0 || height <= 0) {
    return {
      bucket: "other",
      source: "unreadable",
      reason: "Dimensions could not be read",
    };
  }
  return bucketFromMeasurement({
    width,
    height,
    snapped: snapRatio(width, height),
    tied: tiedStandardAspects(width, height),
    filenameHint: parseAspectFromFilename(input.filename),
  });
}

export interface MatchAsset {
  id: string;
  mediaKind: RegistryMediaKind;
  bucket: IntakeBucket;
}

const MATCH_COUNT = "Select 2 or 3 assets";
const MATCH_MIXED = "Mixed image and video — a Meta creative is one media kind";
const MATCH_OTHER = "Move files out of Other before matching";

/**
 * Why Match must stay disabled, or null when the selection is dual or full.
 * Every refusal the button can show is one of these sentences.
 */
export function matchRefusal(assets: readonly MatchAsset[]): string | null {
  if (assets.length < 2 || assets.length > 3) return MATCH_COUNT;
  const kinds = new Set(assets.map((asset) => asset.mediaKind));
  if (kinds.size > 1) return MATCH_MIXED;
  if (assets.some((asset) => asset.bucket === "other")) return MATCH_OTHER;
  const counts = new Map<IntakeBucket, number>();
  for (const asset of assets) {
    counts.set(asset.bucket, (counts.get(asset.bucket) ?? 0) + 1);
  }
  for (const [bucket, count] of counts) {
    if (count > 1) return `Two assets are ${bucket} — a creative takes each ratio once`;
  }
  const buckets = new Set(assets.map((asset) => asset.bucket));
  if (assets.length === 2) {
    const feed = buckets.has("4:5") || buckets.has("1:1");
    if (feed && buckets.has("9:16")) return null;
    return "Dual needs one feed asset (4:5 or 1:1) and one 9:16";
  }
  if (buckets.has("4:5") && buckets.has("1:1") && buckets.has("9:16")) return null;
  return "Full needs 4:5, 1:1 and 9:16";
}

export function matchAssetMode(assets: readonly MatchAsset[]): AssetMode | null {
  if (matchRefusal(assets)) return null;
  return assets.length === 3 ? "full" : "dual";
}

export interface IntakeSendAsset {
  id: string;
  mediaKind: RegistryMediaKind;
  bucket: IntakeBucket;
  /** Group this asset is matched into. Null = a single. */
  groupId: string | null;
}

export interface IntakeOwnedCreative {
  /** Stable key: the match group id, or `single:<assetId>`. */
  key: string;
  creativeId: string;
  /** What send last wrote. A different draft fingerprint was edited in the drawer. */
  fingerprint: string | null;
  /** Fingerprint of the creative as it sits in the draft now. */
  draftFingerprint: string | null;
}

export interface IntakeRouteState {
  assetId: string;
  enabled: boolean;
  uploadStatus: string;
}

export interface IntakeSendPlan {
  /** Creatives to insert or update. `noop` is a second send of the same bytes. */
  meta: Array<{
    key: string;
    creativeId: string | null;
    mode: AssetMode;
    assetIds: string[];
    action: "insert" | "update" | "noop";
  }>;
  /** MML creative ids to delete. Drawer creatives are never in this list. */
  removeCreativeIds: string[];
  tiktokWrites: Array<{ assetId: string; enabled: boolean }>;
  notes: string[];
}

const BUCKET_ORDER: readonly IntakeBucket[] = ["4:5", "1:1", "9:16", "other"];

export function singleGroupKey(assetId: string): string {
  return `single:${assetId}`;
}

export function intakeCreativeFingerprint(input: {
  mode: AssetMode;
  assetIds: readonly string[];
  headline: string;
  description: string;
  caption: string;
  cta: string;
  destinationUrl: string;
  pageId: string;
  instagramActorId: string;
  name: string;
}): string {
  return [
    input.mode,
    [...input.assetIds].join(","),
    input.headline,
    input.description,
    input.caption,
    input.cta,
    input.destinationUrl,
    input.pageId,
    input.instagramActorId,
    input.name,
  ].join("\u001f");
}

function desiredCreatives(assets: readonly IntakeSendAsset[]): Array<{
  key: string;
  mode: AssetMode;
  assetIds: string[];
}> {
  const byGroup = new Map<string, IntakeSendAsset[]>();
  const singles: IntakeSendAsset[] = [];
  for (const asset of assets) {
    if (!asset.groupId) {
      singles.push(asset);
      continue;
    }
    const list = byGroup.get(asset.groupId) ?? [];
    list.push(asset);
    byGroup.set(asset.groupId, list);
  }
  const desired: Array<{ key: string; mode: AssetMode; assetIds: string[] }> = [];
  for (const [key, members] of byGroup) {
    const mode = matchAssetMode(members);
    if (!mode) continue;
    desired.push({
      key,
      mode,
      assetIds: orderAssetIds(members),
    });
  }
  for (const asset of singles) {
    if (asset.bucket === "other") continue;
    desired.push({
      key: singleGroupKey(asset.id),
      mode: "single",
      assetIds: [asset.id],
    });
  }
  return desired;
}

function orderAssetIds(assets: readonly IntakeSendAsset[]): string[] {
  return [...assets]
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket))
    .map((asset) => asset.id);
}

function tiktokWants(asset: IntakeSendAsset): boolean {
  return asset.mediaKind === "video" && asset.bucket === "9:16";
}

/**
 * What a send (or a group removal) may change.
 * A second call with the drafts already matching this plan writes nothing.
 */
export function planIntakeSend(input: {
  assets: readonly IntakeSendAsset[];
  owned: readonly IntakeOwnedCreative[];
  routes: readonly IntakeRouteState[];
  metaLaunched: boolean;
  tiktokLaunched: boolean;
}): IntakeSendPlan {
  const notes: string[] = [];
  const ownedByKey = new Map(input.owned.map((row) => [row.key, row]));
  const desired = desiredCreatives(input.assets);
  const desiredKeys = new Set(desired.map((row) => row.key));
  const meta: IntakeSendPlan["meta"] = [];

  for (const row of desired) {
    const owned = ownedByKey.get(row.key);
    if (!owned) {
      meta.push({
        key: row.key,
        creativeId: null,
        mode: row.mode,
        assetIds: row.assetIds,
        action: "insert",
      });
      continue;
    }
    const edited =
      owned.fingerprint != null &&
      owned.draftFingerprint != null &&
      owned.fingerprint !== owned.draftFingerprint;
    if (edited) {
      notes.push(`Left "${row.key}" — it was edited in the drawer`);
      meta.push({
        key: row.key,
        creativeId: owned.creativeId,
        mode: row.mode,
        assetIds: row.assetIds,
        action: "noop",
      });
      continue;
    }
    const unchanged =
      owned.fingerprint != null &&
      owned.draftFingerprint === owned.fingerprint &&
      owned.fingerprint.startsWith(`${row.mode}\u001f${row.assetIds.join(",")}\u001f`);
    meta.push({
      key: row.key,
      creativeId: owned.creativeId,
      mode: row.mode,
      assetIds: row.assetIds,
      action: unchanged ? "noop" : "update",
    });
  }

  const removeCreativeIds: string[] = [];
  for (const owned of input.owned) {
    if (desiredKeys.has(owned.key)) continue;
    const edited =
      owned.fingerprint != null &&
      owned.draftFingerprint != null &&
      owned.fingerprint !== owned.draftFingerprint;
    if (edited) {
      notes.push(`Left the creative for ${owned.key} — it was edited in the drawer`);
      continue;
    }
    if (input.metaLaunched) {
      notes.push(META_LAUNCHED_UNROUTE_NOTE);
      continue;
    }
    removeCreativeIds.push(owned.creativeId);
  }

  const routeByAsset = new Map(input.routes.map((route) => [route.assetId, route]));
  const tiktokWrites: IntakeSendPlan["tiktokWrites"] = [];
  const seenRoute = new Set<string>();
  for (const asset of input.assets) {
    seenRoute.add(asset.id);
    const want = tiktokWants(asset);
    const current = routeByAsset.get(asset.id);
    if (current?.enabled === want) continue;
    if (current?.enabled && !want && (current.uploadStatus === "launched" || input.tiktokLaunched)) {
      notes.push(TIKTOK_LAUNCHED_UNROUTE_NOTE);
      continue;
    }
    if (!current && !want) {
      // Images stay off by the existing default. A video that is not 9:16
      // would otherwise be enabled the moment it lands on the Meta draft.
      if (asset.mediaKind === "video") tiktokWrites.push({ assetId: asset.id, enabled: false });
      continue;
    }
    tiktokWrites.push({ assetId: asset.id, enabled: want });
  }
  for (const route of input.routes) {
    if (seenRoute.has(route.assetId) || !route.enabled) continue;
    if (route.uploadStatus === "launched" || input.tiktokLaunched) {
      notes.push(TIKTOK_LAUNCHED_UNROUTE_NOTE);
      continue;
    }
    tiktokWrites.push({ assetId: route.assetId, enabled: false });
  }

  return {
    meta,
    removeCreativeIds,
    tiktokWrites,
    notes: [...new Set(notes)],
  };
}

export function intakeSendChanges(plan: IntakeSendPlan): boolean {
  return (
    plan.meta.some((row) => row.action !== "noop") ||
    plan.removeCreativeIds.length > 0 ||
    plan.tiktokWrites.length > 0
  );
}

/** Registry aspect stored on creative_assets. Other is a real bucket, not a guess. */
export function registryAspect(bucket: IntakeBucket): RegistryAspect {
  return bucket;
}
