import type { AdCreativeDraft, CampaignDraft, CreativeAssignmentMatrix } from "../types.ts";
import { attachedAdSetKey, parseAttachedAdSetKey } from "../types.ts";
import { creativeTriggersVariationRotation } from "./creative.ts";
import { adSetAudienceRemoved } from "../wizard/import-edits.ts";

/**
 * A Single-mode creative with 2+ variations is a Dynamic Creative. Meta allows
 * one ad in that ad set (subcode 1885553). The assignment matrix is
 * ad set id → creative ids.
 */

export const ROTATION_SHARE_MESSAGE =
  "Ads with several variations need their own ad set. Meta allows one ad in a dynamic ad set.";

export const ROTATION_NOT_DYNAMIC_MESSAGE =
  "Ads with several variations can't go into this ad set. Meta can't switch an existing ad set to dynamic.";

export const ROTATION_HAS_AD_MESSAGE =
  "This dynamic ad set already has an ad. Meta allows one ad in a dynamic ad set.";

export interface LiveAdSetState {
  isDynamicCreative: boolean;
  adCount: number;
}

export interface RotationAdSetProblem {
  kind: "shares" | "existing_not_dynamic" | "existing_has_ad";
  adSetId: string;
  adSetName: string;
  /** Rotation creatives on this ad set. A share offers one split per id. */
  rotationCreativeIds: string[];
  message: string;
}

interface AdSetRow {
  id: string;
  name: string;
  creativeIds: string[];
  /** Omitted when this launch creates the ad set. */
  existing?: LiveAdSetState | "unknown";
}

function isRotation(creatives: AdCreativeDraft[], id: string): boolean {
  const creative = creatives.find((c) => c.id === id);
  return creative ? creativeTriggersVariationRotation(creative) : false;
}

function problemsForRows(rows: AdSetRow[], creatives: AdCreativeDraft[]): RotationAdSetProblem[] {
  const problems: RotationAdSetProblem[] = [];
  for (const row of rows) {
    const assigned = [...new Set(row.creativeIds)].filter((id) => creatives.some((c) => c.id === id));
    const rotationCreativeIds = assigned.filter((id) => isRotation(creatives, id));
    if (rotationCreativeIds.length === 0) continue;
    if (assigned.length > 1) {
      problems.push({
        kind: "shares",
        adSetId: row.id,
        adSetName: row.name,
        rotationCreativeIds,
        message: ROTATION_SHARE_MESSAGE,
      });
      continue;
    }
    if (row.existing === undefined) continue;
    const blocked =
      row.existing === "unknown" || !row.existing.isDynamicCreative
        ? "existing_not_dynamic"
        : row.existing.adCount >= 1
          ? "existing_has_ad"
          : null;
    if (!blocked) continue;
    problems.push({
      kind: blocked,
      adSetId: row.id,
      adSetName: row.name,
      rotationCreativeIds,
      message: blocked === "existing_has_ad" ? ROTATION_HAS_AD_MESSAGE : ROTATION_NOT_DYNAMIC_MESSAGE,
    });
  }
  return problems;
}

function createdRows(draft: CampaignDraft): AdSetRow[] {
  return draft.adSetSuggestions
    .filter((adSet) => adSet.enabled && !adSetAudienceRemoved(adSet, draft.audiences))
    .map((adSet) => ({
      id: adSet.id,
      name: adSet.name,
      creativeIds: draft.creativeAssignments?.[adSet.id] ?? [],
    }));
}

function attachedRows(
  draft: CampaignDraft,
  live?: Map<string, LiveAdSetState>,
): AdSetRow[] {
  const selected =
    draft.settings.existingMetaAdSets ??
    (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
  return selected.map((adSet) => {
    const key = attachedAdSetKey(adSet.id);
    const known = live?.get(adSet.id);
    return {
      id: key,
      name: adSet.name,
      creativeIds: draft.creativeAssignments?.[key] ?? [],
      existing: known ?? "unknown",
    };
  });
}

/**
 * Problems the assign step and review can see without calling Meta.
 * An existing ad set is treated as not switchable to dynamic. Launch reads
 * the live flag and applies {@link existingRotationRefusal} instead.
 */
export function rotationProblemsForDraft(draft: CampaignDraft): RotationAdSetProblem[] {
  const mode = draft.settings.wizardMode ?? "new";
  if (mode === "attach_all_adsets") {
    const rotation = draft.creatives.filter((c) => creativeTriggersVariationRotation(c));
    if (rotation.length === 0) return [];
    if (draft.creatives.length > 1) {
      return [
        {
          kind: "shares",
          adSetId: "",
          adSetName: "every selected ad set",
          rotationCreativeIds: rotation.map((c) => c.id),
          message: ROTATION_SHARE_MESSAGE,
        },
      ];
    }
    return [
      {
        kind: "existing_not_dynamic",
        adSetId: "",
        adSetName: "the existing ad sets",
        rotationCreativeIds: rotation.map((c) => c.id),
        message: ROTATION_NOT_DYNAMIC_MESSAGE,
      },
    ];
  }
  if (mode === "attach_adset") return problemsForRows(attachedRows(draft), draft.creatives);
  return problemsForRows(createdRows(draft), draft.creatives);
}

/** The assign step's view: the ad sets on screen and the matrix. */
export function rotationProblemsFromMatrix(input: {
  creatives: AdCreativeDraft[];
  adSets: Array<{ id: string; name: string }>;
  assignments: CreativeAssignmentMatrix;
  /** True when these ad sets already exist on Meta. */
  existing: boolean;
}): RotationAdSetProblem[] {
  return problemsForRows(
    input.adSets.map((adSet) => ({
      id: adSet.id,
      name: adSet.name,
      creativeIds: input.assignments[adSet.id] ?? [],
      ...(input.existing ? { existing: "unknown" as const } : {}),
    })),
    input.creatives,
  );
}

export function rotationAssignmentErrors(draft: CampaignDraft): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const problem of rotationProblemsForDraft(draft)) {
    if (seen.has(problem.message)) continue;
    seen.add(problem.message);
    errors.push(problem.message);
  }
  return errors;
}

/** Ad sets this launch creates that must be `is_dynamic_creative`. */
export function dynamicAdSetIdsForDraft(draft: CampaignDraft): string[] {
  const mode = draft.settings.wizardMode ?? "new";
  if (mode === "attach_adset" || mode === "attach_all_adsets") return [];
  const ids: string[] = [];
  for (const row of createdRows(draft)) {
    const assigned = [...new Set(row.creativeIds)].filter((id) => draft.creatives.some((c) => c.id === id));
    if (assigned.length === 1 && isRotation(draft.creatives, assigned[0]!)) ids.push(row.id);
  }
  return ids;
}

/**
 * Share violations, which need no Meta read. Null when the only open question
 * is the live state of an existing ad set.
 */
export function rotationShareRefusal(draft: CampaignDraft): string | null {
  const shares = rotationProblemsForDraft(draft).filter((p) => p.kind === "shares");
  if (shares.length === 0) return null;
  const where = shares.map((p) => `"${p.adSetName}"`).join(", ");
  return `${ROTATION_SHARE_MESSAGE} Affected: ${where}.`;
}

export interface ExistingRotationRow {
  metaId: string;
  name: string;
  creativeIds: string[];
}

/**
 * A rotation creative aimed at an ad set that already exists. Missing live
 * state blocks: we will not guess that the ad set is dynamic and empty.
 * A dynamic ad set with no ads can take this one creative.
 */
export function existingRotationRefusal(
  rows: ExistingRotationRow[],
  creatives: AdCreativeDraft[],
  live: { get(id: string): LiveAdSetState | undefined },
): string | null {
  const problems = problemsForRows(
    rows.map((row) => ({
      id: row.metaId,
      name: row.name,
      creativeIds: row.creativeIds,
      existing: live.get(row.metaId) ?? "unknown",
    })),
    creatives,
  );
  if (problems.length === 0) return null;
  const first = problems[0]!;
  const where = [...new Set(problems.map((p) => `"${p.adSetName}"`))].join(", ");
  return `${first.message} Affected: ${where}.`;
}

export function attachAdSetRotationRows(draft: CampaignDraft): ExistingRotationRow[] {
  return attachedRows(draft).map((row) => ({
    metaId: parseAttachedAdSetKey(row.id) ?? row.id,
    name: row.name,
    creativeIds: row.creativeIds,
  }));
}

/** True when a lone rotation creative is waiting on live ad set state. */
export function rotationNeedsLiveAdSetCheck(draft: CampaignDraft): boolean {
  if (!draft.creatives.some((c) => creativeTriggersVariationRotation(c))) return false;
  if (rotationShareRefusal(draft)) return false;
  const mode = draft.settings.wizardMode ?? "new";
  return mode === "attach_adset" || mode === "attach_all_adsets";
}

/**
 * Every creative in a bulk-attach goes to every selected ad set.
 * `live` null means the ad sets have not been read yet: a lone rotation
 * creative stays unresolved (the caller fetches). Several creatives are a
 * share and need no read.
 */
export function bulkAttachRotationMessage(
  creatives: AdCreativeDraft[],
  adSetIds: string[],
  live: { get(id: string): LiveAdSetState | undefined } | null,
): string | null {
  const rotation = creatives.filter((c) => creativeTriggersVariationRotation(c));
  if (rotation.length === 0) return null;
  if (creatives.length > 1) return ROTATION_SHARE_MESSAGE;
  if (!live) return null;
  const rows: ExistingRotationRow[] = adSetIds.map((id) => ({
    metaId: id,
    name: id,
    creativeIds: creatives.map((c) => c.id),
  }));
  return existingRotationRefusal(rows, creatives, live);
}
