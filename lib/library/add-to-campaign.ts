/**
 * Published-row "Add to campaign".
 *
 * Opens the wizard's existing attach family with one live campaign already
 * in the Selected campaign block. Neither sub-mode card is chosen: the
 * operator picks Create new ad set or Attach ads to all existing ad sets
 * in the wizard, and the wizard then follows that mode as it does today.
 *
 * `wizardMode` is `"attach_campaign"` while the choice is pending so the
 * block the wizard already renders stays on screen. `attachSubmodePending`
 * is what keeps both cards unselected. It is not a fifth launch mode.
 */

import { createDefaultAssetVariation, createDefaultCreative } from "../campaign-defaults.ts";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "../mock-data.ts";
import { archivedCampaignRefusal } from "../meta/launch-error-classify.ts";
import { mapMetaObjectiveToInternal } from "../meta/campaign.ts";
import type {
  AdCreativeDraft,
  CampaignDraft,
  CampaignObjective,
  ExistingMetaCampaignSnapshot,
  OptimisationGoal,
} from "../types.ts";

export const ADD_SUBMODE_REQUIRED =
  "Choose Create new ad set or Attach ads to all existing ad sets";

/** The wizard URL. No mode query — the draft carries the campaign. */
export function addToCampaignHref(draftId: string): string {
  return `/campaign/${draftId}`;
}

/** Fields the live campaign read needs. Not a Graph payload. */
export interface LiveCampaignForAdd {
  id: string;
  name: string;
  objective: string;
  status: string;
  effectiveStatus?: string;
  buyingType?: string;
}

export type AddToCampaignDecision =
  | {
      ok: true;
      campaign: LiveCampaignForAdd;
      objective: CampaignObjective;
      snapshot: ExistingMetaCampaignSnapshot;
    }
  | { ok: false; message: string };

function deliveryStatus(live: LiveCampaignForAdd): string {
  return (live.effectiveStatus ?? live.status ?? "").trim().toUpperCase();
}

export function decideAddToCampaign(
  live: LiveCampaignForAdd,
  now: string,
): AddToCampaignDecision {
  const id = live.id.trim();
  if (!id) {
    return { ok: false, message: "This campaign has no Meta campaign id." };
  }
  const status = deliveryStatus(live);
  if (status === "ARCHIVED") {
    return { ok: false, message: archivedCampaignRefusal(id) };
  }
  if (status === "DELETED") {
    return {
      ok: false,
      message: `Campaign ${id} is deleted in Meta. Duplicate this draft to launch a new campaign.`,
    };
  }
  const buying = (live.buyingType ?? "").trim().toUpperCase();
  if (buying && buying !== "AUCTION") {
    return {
      ok: false,
      message: `Buying type "${live.buyingType}" not supported (this wizard only creates auction ad sets).`,
    };
  }
  const objective = mapMetaObjectiveToInternal(live.objective);
  if (!objective) {
    return {
      ok: false,
      message: `Objective "${live.objective || "unknown"}" not supported by this wizard.`,
    };
  }
  const snapshot: ExistingMetaCampaignSnapshot = {
    id,
    name: live.name,
    objective: live.objective,
    internalObjective: objective,
    status: live.status,
    effectiveStatus: live.effectiveStatus,
    capturedAt: now,
    locked: true,
  };
  return { ok: true, campaign: { ...live, id }, objective, snapshot };
}

function blankCreative(source: AdCreativeDraft | undefined): AdCreativeDraft {
  const base = source ?? createDefaultCreative();
  const variations =
    base.assetVariations.length > 0
      ? base.assetVariations
      : [createDefaultAssetVariation(["9:16"])];
  return {
    id: crypto.randomUUID(),
    name: base.name,
    // The carried name was not typed into this draft's Ad Name field.
    nameSource: "generated",
    sourceType: "new",
    identity: {
      pageId: base.identity.pageId,
      instagramAccountId: base.identity.instagramAccountId,
      ...(base.identity.instagramActorId
        ? { instagramActorId: base.identity.instagramActorId }
        : {}),
    },
    mediaType: base.mediaType,
    assetMode: base.assetMode,
    assetVariations: variations.map((variation) => ({
      id: crypto.randomUUID(),
      name: variation.name,
      assets: variation.assets.map((asset) => ({
        id: crypto.randomUUID(),
        aspectRatio: asset.aspectRatio,
        uploadStatus: "pending" as const,
      })),
    })),
    captions: base.captions.map((caption) => ({
      id: crypto.randomUUID(),
      text: caption.text,
    })),
    headline: base.headline,
    description: base.description,
    destinationUrl: base.destinationUrl,
    cta: base.cta,
    enhancements: { ...base.enhancements },
  };
}

/**
 * A new draft sitting on the Selected campaign block. Copy, CTA, URL and
 * page/Instagram come from the published draft's first creative. Assets,
 * the published Meta ids, and the launch summary do not.
 */
export function seedAddToCampaignDraft(
  source: CampaignDraft,
  live: LiveCampaignForAdd,
  opts: { id: string; now: string },
): CampaignDraft {
  const decision = decideAddToCampaign(live, opts.now);
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[decision.objective] ?? [];
  const goalValid = goals.some((goal) => goal.value === source.settings.optimisationGoal);
  const optimisationGoal: OptimisationGoal = goalValid
    ? source.settings.optimisationGoal
    : goals[0]?.value ?? source.settings.optimisationGoal;
  const snapshot = decision.snapshot;
  return {
    ...source,
    id: opts.id,
    status: "draft",
    createdAt: opts.now,
    updatedAt: opts.now,
    metaCampaignId: undefined,
    launchSummary: undefined,
    creatives: [blankCreative(source.creatives[0])],
    adSetSuggestions: source.adSetSuggestions.map((suggestion) => {
      const { metaAdSetId: _dropped, ...rest } = suggestion;
      return rest;
    }),
    settings: {
      ...source.settings,
      objective: decision.objective,
      optimisationGoal,
      wizardMode: "attach_campaign",
      attachSubmodePending: true,
      existingMetaCampaigns: [snapshot],
      existingMetaCampaign: snapshot,
      existingMetaAdSet: undefined,
      existingMetaAdSets: undefined,
    },
  };
}
