/**
 * Turn a send plan into Meta draft creatives.
 * Drawer-made creatives are copied through. An untouched starter
 * (the blank creative prepare-draft inserts) is dropped once MML
 * writes a real one, so the drawer shows the creatives Send built.
 */

import { creativeNameFromFilename } from "../creative-name-from-filename.ts";
import {
  createDefaultAsset,
  createDefaultCreative,
} from "../campaign-defaults.ts";
import type { AdCreativeDraft, Asset, AssetMode, CampaignDraft } from "../types.ts";
import {
  intakeCreativeFingerprint,
  type IntakeSendPlan,
} from "./creative-intake.ts";

export interface IntakeAssetRecord {
  id: string;
  filename: string;
  mediaKind: "image" | "video";
  /** Standard ratio only. Other never becomes a creative slot. */
  aspectRatio: "1:1" | "4:5" | "9:16";
  storageBucket: string;
  storagePath: string;
  thumbnailUrl: string | null;
}

export interface IntakeIdentity {
  pageId: string;
  instagramActorId: string;
}

export function creativeDraftFingerprint(creative: AdCreativeDraft): string {
  const variation = creative.assetVariations[0];
  const assetIds = (variation?.assets ?? [])
    .map((asset) => asset.registryAssetId)
    .filter((id): id is string => Boolean(id));
  return intakeCreativeFingerprint({
    mode: creative.assetMode,
    assetIds,
    headline: creative.headline ?? "",
    description: creative.description ?? "",
    caption: creative.captions?.find((row) => row.text)?.text ?? creative.captions?.[0]?.text ?? "",
    cta: creative.cta,
    destinationUrl: creative.destinationUrl ?? "",
    pageId: creative.identity?.pageId ?? "",
    instagramActorId: creative.identity?.instagramActorId ?? creative.identity?.instagramAccountId ?? "",
    name: creative.name ?? "",
  });
}

/** The blank creative prepare-draft inserts. An operator edit is not this. */
export function isUntouchedStarterCreative(creative: AdCreativeDraft): boolean {
  if (creative.nameSource === "operator") return false;
  if (creative.sourceType !== "new") return false;
  if (creative.headline?.trim() || creative.description?.trim()) return false;
  if ((creative.captions ?? []).some((row) => row.text?.trim())) return false;
  if (creative.metaCreativeId || (creative.metaAdIds?.length ?? 0) > 0) return false;
  const assets = (creative.assetVariations ?? []).flatMap((variation) => variation.assets ?? []);
  if (
    assets.some(
      (asset) =>
        asset.registryAssetId ||
        asset.assetHash ||
        asset.videoId ||
        asset.fileName ||
        asset.uploadStatus === "uploaded",
    )
  ) {
    return false;
  }
  return true;
}

function assetFromRecord(record: IntakeAssetRecord): Asset {
  const asset = createDefaultAsset(record.aspectRatio);
  return {
    ...asset,
    registryAssetId: record.id,
    fileName: record.filename,
    storageBucket: record.storageBucket,
    storagePath: record.storagePath,
    thumbnailUrl: record.thumbnailUrl ?? undefined,
    uploadedUrl: record.thumbnailUrl ?? undefined,
    uploadStatus: "pending",
  };
}

function buildCreative(input: {
  existing: AdCreativeDraft | null;
  mode: AssetMode;
  records: IntakeAssetRecord[];
  identity: IntakeIdentity;
  destinationUrl: string;
}): AdCreativeDraft {
  const base = input.existing ?? createDefaultCreative();
  const mediaType = input.records[0]?.mediaKind ?? base.mediaType;
  const name = input.existing
    ? base.name
    : creativeNameFromFilename(input.records[0]?.filename ?? "", "Creative");
  const pageId = input.existing?.identity?.pageId || input.identity.pageId;
  const ig =
    input.existing?.identity?.instagramActorId ||
    input.existing?.identity?.instagramAccountId ||
    input.identity.instagramActorId;
  return {
    ...base,
    name,
    nameSource: input.existing?.nameSource ?? "file",
    sourceType: "new",
    mediaType,
    assetMode: input.mode,
    destinationUrl: input.existing?.destinationUrl || input.destinationUrl,
    identity: {
      pageId,
      instagramAccountId: ig,
      instagramActorId: ig,
    },
    assetVariations: [
      {
        id: base.assetVariations[0]?.id ?? crypto.randomUUID(),
        name: input.records.map((record) => record.filename).join(" + ") || "Variation 1",
        assets: input.records.map(assetFromRecord),
      },
    ],
  };
}

export function applyIntakeToMetaDraft(
  draft: CampaignDraft,
  plan: IntakeSendPlan,
  assets: readonly IntakeAssetRecord[],
  identity: IntakeIdentity,
): {
  draft: CampaignDraft;
  fingerprints: Array<{ key: string; creativeId: string; fingerprint: string }>;
  changed: boolean;
} {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const remove = new Set(plan.removeCreativeIds);
  const ownedIds = new Set(
    plan.meta.map((row) => row.creativeId).filter((id): id is string => Boolean(id)),
  );
  let creatives = draft.creatives.filter((creative) => !remove.has(creative.id));
  const fingerprints: Array<{ key: string; creativeId: string; fingerprint: string }> = [];
  let changed = remove.size > 0;

  for (const row of plan.meta) {
    if (row.action === "noop" && row.creativeId) {
      const existing = creatives.find((creative) => creative.id === row.creativeId);
      if (existing) {
        fingerprints.push({
          key: row.key,
          creativeId: existing.id,
          fingerprint: creativeDraftFingerprint(existing),
        });
      }
      continue;
    }
    const records = row.assetIds
      .map((id) => byId.get(id))
      .filter((record): record is IntakeAssetRecord => Boolean(record));
    if (records.length !== row.assetIds.length) continue;
    const existing = row.creativeId
      ? creatives.find((creative) => creative.id === row.creativeId) ?? null
      : null;
    const next = buildCreative({
      existing,
      mode: row.mode,
      records,
      identity,
      destinationUrl: existing?.destinationUrl || draft.creatives[0]?.destinationUrl || "",
    });
    if (existing) {
      creatives = creatives.map((creative) => (creative.id === existing.id ? next : creative));
    } else {
      creatives = [...creatives, next];
    }
    fingerprints.push({
      key: row.key,
      creativeId: next.id,
      fingerprint: creativeDraftFingerprint(next),
    });
    changed = true;
  }

  const wrote = plan.meta.some((row) => row.action === "insert" || row.action === "update");
  if (wrote) {
    const starters = creatives.filter(
      (creative) => !ownedIds.has(creative.id) && !fingerprints.some((row) => row.creativeId === creative.id) && isUntouchedStarterCreative(creative),
    );
    if (starters.length > 0) {
      const drop = new Set(starters.map((creative) => creative.id));
      creatives = creatives.filter((creative) => !drop.has(creative.id));
      for (const id of drop) remove.add(id);
      changed = true;
    }
  }

  const assignments: CampaignDraft["creativeAssignments"] = {};
  for (const [adSetId, creativeIds] of Object.entries(draft.creativeAssignments ?? {})) {
    assignments[adSetId] = creativeIds.filter((id) => !remove.has(id));
  }

  return {
    draft: { ...draft, creatives, creativeAssignments: assignments },
    fingerprints,
    changed,
  };
}
