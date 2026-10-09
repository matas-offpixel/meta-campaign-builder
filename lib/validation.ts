import {
  applyMetaChannelDefaults,
  type ResolvedChannelDefaults,
} from "./clients/channel-defaults.ts";
import type { CampaignDraft, WizardStep } from "./types.ts";
import { attachedAdSetKey, getVisibleSteps } from "./types.ts";
import { findMultiIgPagesMissingOverride } from "./validation/page-instagram.ts";
import { validateCreativeAssetCompleteness } from "./validation/asset-completeness.ts";
import { findAdSetLocationProblems, findAdSetLocationWarnings } from "./meta/location-targeting.ts";
import { cityRadiusProblemInDraft } from "./meta/location-radius.ts";
import {
  audienceAccountMismatch,
  belongsToOtherAccountLabel,
  enabledAdSetSourceIds,
} from "./audiences/audience-account.ts";
import {
  adSetAudienceRemoved,
  importedAdSetsDefineAudience,
  objectivePixelProblem,
} from "./wizard/import-edits.ts";
import { ADD_SUBMODE_REQUIRED } from "./library/add-to-campaign.ts";
import { rotationAssignmentErrors } from "./meta/rotation-adset.ts";

export const ATTACH_EVENT_BEFORE_LAUNCH = "Attach an event before launching";

/** Uploaded on the draft, but the Meta id was cleared with the previous ad account. */
export function slotNeedsAccountReupload(slot: {
  uploadStatus?: string;
  assetHash?: string;
  videoId?: string;
}): boolean {
  return slot.uploadStatus === "uploaded" && !slot.assetHash?.trim() && !slot.videoId?.trim();
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Worth the operator's attention; never affects `valid`. */
  warnings?: string[];
}

export function validateStep(
  step: WizardStep,
  draft: CampaignDraft,
  defaults?: ResolvedChannelDefaults | null,
): ValidationResult {
  const effective = defaults ? applyMetaChannelDefaults(draft, defaults) : draft;
  switch (step) {
    case 0: return validateAccountSetup(effective);
    case 1: return validateCampaignSetup(effective);
    case 2: return validateOptimisationStrategy(effective);
    case 3: return validateAudiences(effective);
    case 4: return validateCreatives(effective);
    case 5: return validateBudgetSchedule(effective);
    case 6: return validateAssignCreatives(effective);
    case 7: return validateReview(effective);
    default: return { valid: true, errors: [] };
  }
}

function validateAccountSetup(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  // metaAdAccountId is set when the user picks a real Meta account.
  // Fall back to adAccountId for any legacy/mock drafts still in storage.
  const hasAccount =
    !!draft.settings.metaAdAccountId || !!draft.settings.adAccountId;
  if (!hasAccount) errors.push("Ad account is required");
  // Facebook page and Instagram account are selected per ad in the Creatives step.
  return { valid: errors.length === 0, errors };
}

function validateCampaignSetup(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  const mode = draft.settings.wizardMode ?? "new";

  if (draft.settings.attachSubmodePending) {
    errors.push(ADD_SUBMODE_REQUIRED);
    return { valid: false, errors };
  }

  if (mode === "attach_adset") {
    // Attaching to one or more existing ad sets (possibly cross-campaign).
    // Optimisation goal, audiences and budget are inherited from each live ad
    // set and skipped in the wizard.
    const selectedCampaigns =
      draft.settings.existingMetaCampaigns ??
      (draft.settings.existingMetaCampaign
        ? [draft.settings.existingMetaCampaign]
        : []);
    const selectedAdSets =
      draft.settings.existingMetaAdSets ??
      (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
    if (selectedCampaigns.length === 0) {
      errors.push("Pick the existing campaign(s) that own the ad sets");
    }
    if (selectedAdSets.length === 0) {
      errors.push("Pick at least one existing ad set to add ads to");
    }
    // Cross-campaign check: each selected ad set must belong to one of the
    // selected campaigns.
    if (selectedCampaigns.length > 0 && selectedAdSets.length > 0) {
      const allowedCampaignIds = new Set(selectedCampaigns.map((c) => c.id));
      const orphan = selectedAdSets.find(
        (a) => a.campaignId && !allowedCampaignIds.has(a.campaignId),
      );
      if (orphan) {
        errors.push(
          `Selected ad set "${orphan.name}" does not belong to any of the selected campaigns`,
        );
      }
    }
    return { valid: errors.length === 0, errors };
  }

  if (mode === "attach_campaign") {
    // Attaching a new ad set under one or more existing campaigns: only the
    // picker selection + an optimisation goal are needed.
    const selectedCampaigns =
      draft.settings.existingMetaCampaigns ??
      (draft.settings.existingMetaCampaign
        ? [draft.settings.existingMetaCampaign]
        : []);
    if (selectedCampaigns.length === 0) {
      errors.push("Pick at least one existing campaign to add an ad set to");
    }
    if (!draft.settings.optimisationGoal) {
      errors.push("Optimisation goal is required");
    }
    if (!draft.settings.objective) {
      errors.push("Selected campaign has an unsupported objective");
    }
    return { valid: errors.length === 0, errors };
  }

  if (mode === "attach_all_adsets") {
    // Attaching new ads to ALL active/paused ad sets across selected campaigns.
    // No ad set picker or budget form — those are resolved at launch time.
    const selectedCampaigns =
      draft.settings.existingMetaCampaigns ??
      (draft.settings.existingMetaCampaign
        ? [draft.settings.existingMetaCampaign]
        : []);
    if (selectedCampaigns.length === 0) {
      errors.push("Pick at least one existing campaign");
    }
    return { valid: errors.length === 0, errors };
  }

  if (!draft.settings.campaignName.trim()) errors.push("Campaign name is required");
  if (!draft.settings.objective) errors.push("Campaign objective is required");
  if (!draft.settings.optimisationGoal) errors.push("Optimisation goal is required");
  if (!draft.settings.eventId?.trim()) errors.push(ATTACH_EVENT_BEFORE_LAUNCH);
  if (draft.importMeta) {
    const pixelProblem = objectivePixelProblem(draft);
    if (pixelProblem) errors.push(pixelProblem);
  }
  return { valid: errors.length === 0, errors };
}

function validateOptimisationStrategy(draft: CampaignDraft): ValidationResult {
  // Inherited from live ad sets in attach_adset / attach_all_adsets mode.
  if (
    draft.settings.wizardMode === "attach_adset" ||
    draft.settings.wizardMode === "attach_all_adsets"
  ) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  const strat = draft.optimisationStrategy;
  if (!strat) return { valid: true, errors: [] };
  if (strat.mode === "custom" && strat.rules.length === 0) {
    errors.push("Add at least one rule in custom mode, or switch to benchmarks");
  }
  return { valid: errors.length === 0, errors };
}

function foreignAudienceNotes(draft: CampaignDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const launchAccount = draft.settings.metaAdAccountId || draft.settings.adAccountId;
  const referenced = enabledAdSetSourceIds(draft.adSetSuggestions ?? []);
  for (const group of draft.audiences.pageGroups) {
    for (const status of group.engagementAudienceStatuses ?? []) {
      if (!audienceAccountMismatch(status.accountId, launchAccount)) continue;
      const name = group.name || "Page group";
      const line = `${name}: ${belongsToOtherAccountLabel(status.accountId ?? "")}`;
      if (referenced.has(group.id)) errors.push(line);
      else warnings.push(line);
    }
  }
  return { errors, warnings };
}

function audiencesComeFromLiveAdSets(draft: CampaignDraft): boolean {
  return (
    draft.settings.wizardMode === "attach_adset" ||
    draft.settings.wizardMode === "attach_all_adsets"
  );
}

function validateAudiences(draft: CampaignDraft): ValidationResult {
  // Attach-to-ad-set launches never send the draft's audiences. A foreign
  // audience is a note, not a blocker.
  if (audiencesComeFromLiveAdSets(draft)) {
    const foreign = foreignAudienceNotes(draft);
    const warnings = [...foreign.errors, ...foreign.warnings];
    return warnings.length > 0
      ? { valid: true, errors: [], warnings }
      : { valid: true, errors: [] };
  }
  const errors: string[] = [];
  const { audiences } = draft;
  const hasPageGroups = audiences.pageGroups.some((g) => g.pageIds.length > 0);
  const hasCustom = audiences.customAudienceGroups.some((g) => g.audienceIds.length > 0);
  const hasSaved = audiences.savedAudiences.audienceIds.length > 0;
  const hasInterests = audiences.interestGroups.some((g) => g.interests.length > 0);

  if (
    !hasPageGroups &&
    !hasCustom &&
    !hasSaved &&
    !hasInterests &&
    !importedAdSetsDefineAudience(draft)
  ) {
    errors.push("Select at least one audience source");
  }

  const foreign = foreignAudienceNotes(draft);
  errors.push(...foreign.errors);

  for (const pageId of findMultiIgPagesMissingOverride(draft)) {
    errors.push(
      `Page ${pageId} has multiple linked Instagram accounts — pick one in the Instagram Account section below`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(foreign.warnings.length ? { warnings: foreign.warnings } : {}),
  };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const OFFSITE_OBJECTIVES = new Set([
  "purchase",
  "initiate_checkout",
  "registration",
  "traffic",
]);

/** An Instagram video boosted into an offsite campaign. A carousel is not. */
function existingPostVideoNeedsUrl(
  draft: CampaignDraft,
  creative: CampaignDraft["creatives"][number],
): boolean {
  if (creative.existingPost?.source !== "instagram") return false;
  if (creative.existingPost.mediaKind !== "video") return false;
  const objective = draft.settings.objective;
  if (!objective || !OFFSITE_OBJECTIVES.has(objective)) return false;
  return !creative.destinationUrl?.trim();
}

function validateCreatives(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  if (draft.creatives.length === 0) {
    errors.push("Add at least one ad");
    return { valid: false, errors };
  }

  const accountName =
    draft.settings.metaAdAccountId?.trim() ||
    draft.settings.adAccountId?.trim() ||
    "this ad account";

  draft.creatives.forEach((c, i) => {
    const label = c.name?.trim() ? `"${c.name}"` : `Ad #${i + 1}`;
    if (!c.identity?.pageId) errors.push(`${label}: Facebook page is required`);

    const sourceType = c.sourceType ?? "new";

    if (sourceType === "new") {
      // Caption / primary text
      const captions = c.captions ?? [];
      const hasCaption = captions.some((cap) => cap.text?.trim());
      if (!hasCaption) errors.push(`${label}: Primary text (caption) is required`);

      // Destination URL — must be present and look like a URL
      const url = c.destinationUrl?.trim() ?? "";
      if (!url) {
        errors.push(`${label}: Destination URL is required`);
      } else if (!isValidUrl(url)) {
        errors.push(`${label}: Destination URL must start with https:// (got "${url.slice(0, 40)}")`);
      }

      // CTA
      if (!c.cta) errors.push(`${label}: Call to action is required`);

      // Asset variations
      const variations = c.assetVariations ?? [];
      if (variations.length === 0) {
        errors.push(`${label}: At least one asset variation is required`);
      } else {
        for (const v of variations) {
          const slots = v.assets ?? [];
          const varLabel = v.name?.trim() ? `"${v.name}"` : "Variation";
          if (slots.length === 0) {
            errors.push(`${label} › ${varLabel}: No asset slots defined`);
          } else {
            for (const slot of slots) {
              if (slot.uploadStatus === "pending") {
                errors.push(`${label} › ${varLabel} › ${slot.aspectRatio}: Asset not yet uploaded`);
              } else if (slot.uploadStatus === "uploading") {
                errors.push(`${label} › ${varLabel} › ${slot.aspectRatio}: Upload still in progress`);
              } else if (slot.uploadStatus === "error") {
                errors.push(`${label} › ${varLabel} › ${slot.aspectRatio}: Upload failed — retry or remove`);
              } else if (slotNeedsAccountReupload(slot)) {
                errors.push(
                  `${label} › ${varLabel} › ${slot.aspectRatio}: Re-upload to ${accountName} — this asset belongs to the previous ad account`,
                );
              }
            }
          }
        }
      }
    }

    if (sourceType === "existing_post") {
      if (!c.existingPost?.postId) errors.push(`${label}: Select an existing post`);
      if (existingPostVideoNeedsUrl(draft, c)) {
        errors.push(
          `${label}: This is an Instagram video. This campaign optimises for a website event; the boosted post needs a destination URL`,
        );
      }
      if (c.destinationUrl?.trim() && !c.cta) {
        errors.push(`${label}: A destination URL needs a call to action`);
      }
    }

    // A boosted post has no asset slots. The post is the creative.
    if (sourceType !== "existing_post") {
      // Asset completeness: dual/full mode requires all aspect ratio slots to have
      // a Meta asset ID before launch (assetHash for images, videoId for videos).
      for (const issue of validateCreativeAssetCompleteness(c)) {
        errors.push(
          `${label} › ${issue.variationName}: ${issue.assetMode} mode requires ${issue.missingRatios.join(" + ")} — upload the missing aspect ratio(s) or switch to Single mode`,
        );
      }
    }
  });

  for (const pageId of findMultiIgPagesMissingOverride(draft)) {
    errors.push(
      `${pageId}: Pick the Instagram account for this Facebook Page before continuing`,
    );
  }

  // attach_all has no assign step. Every creative lands on every existing ad set.
  if (draft.settings.wizardMode === "attach_all_adsets") {
    errors.push(...rotationAssignmentErrors(draft));
  }

  return { valid: errors.length === 0, errors };
}

function validateBudgetSchedule(draft: CampaignDraft): ValidationResult {
  // Inherited from live ad sets; budget step is skipped in these modes.
  if (
    draft.settings.wizardMode === "attach_adset" ||
    draft.settings.wizardMode === "attach_all_adsets"
  ) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  const bs = draft.budgetSchedule;
  if (!bs.budgetAmount || bs.budgetAmount <= 0) {
    errors.push("Budget amount must be greater than 0");
  }
  if (!bs.startDate) errors.push("Start date is required");
  if (!bs.endDate) {
    errors.push(
      bs.budgetType === "lifetime"
        ? "Lifetime budgets need an end date."
        : "End date is required",
    );
  }
  if (bs.startDate && bs.endDate && bs.startDate >= bs.endDate) {
    errors.push("End date must be after start date");
  }
  const enabled = (draft.adSetSuggestions ?? []).filter(
    (s) => s.enabled && !adSetAudienceRemoved(s, draft.audiences),
  );
  errors.push(...findAdSetLocationProblems(enabled, bs));
  const radiusProblem = cityRadiusProblemInDraft(draft);
  if (radiusProblem) errors.push(radiusProblem);
  const warnings = findAdSetLocationWarnings(enabled, bs);
  return { valid: errors.length === 0, errors, ...(warnings.length ? { warnings } : {}) };
}

function validateAssignCreatives(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];

  // attach_all_adsets: step 6 is skipped entirely (not visible), so no
  // assignment validation needed — all creatives go to all ad sets at launch.
  if (draft.settings.wizardMode === "attach_all_adsets") {
    return { valid: true, errors: [] };
  }

  // attach_adset: each selected ad set is keyed in the assignment matrix by
  // `attachedAdSetKey(metaAdSetId)`. The wizard's adSetSuggestions array
  // isn't populated in this mode, so use the matrix directly.
  if (draft.settings.wizardMode === "attach_adset") {
    const selectedAdSets =
      draft.settings.existingMetaAdSets ??
      (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
    if (selectedAdSets.length === 0) {
      // Step 1 already flagged this — don't double-error here.
      return { valid: errors.length === 0, errors };
    }
    if (draft.creatives.length > 0) {
      const adSetsWithoutAds = selectedAdSets.filter((a) => {
        const assigned = draft.creativeAssignments?.[attachedAdSetKey(a.id)] ?? [];
        return assigned.length === 0;
      });
      if (adSetsWithoutAds.length === selectedAdSets.length) {
        errors.push("Assign at least one ad to one of the selected ad sets");
      } else if (adSetsWithoutAds.length > 0) {
        errors.push(
          `These ad sets have no ads assigned: ${adSetsWithoutAds.map((a) => `"${a.name}"`).join(", ")}`,
        );
      }
    }
    errors.push(...rotationAssignmentErrors(draft));
    return { valid: errors.length === 0, errors };
  }

  const enabledSets = draft.adSetSuggestions.filter(
    (s) => s.enabled && !adSetAudienceRemoved(s, draft.audiences),
  );
  if (enabledSets.length === 0) {
    errors.push("Enable at least one ad set");
  }
  const hasAssignment = Object.values(draft.creativeAssignments).some(
    (creativeIds) => creativeIds.length > 0
  );
  if (!hasAssignment && draft.creatives.length > 0 && enabledSets.length > 0) {
    errors.push("Assign at least one creative to an ad set");
  }
  errors.push(...rotationAssignmentErrors(draft));
  return { valid: errors.length === 0, errors };
}

function validateReview(draft: CampaignDraft): ValidationResult {
  // Aggregate only the steps that are visible for the current wizard mode.
  // Step 7 (Review) itself is excluded to avoid recursion.
  const visible = getVisibleSteps(draft.settings.wizardMode).filter(
    (s) => s !== 7,
  );
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  for (const step of visible) {
    const result = validateStep(step, draft);
    allErrors.push(...result.errors);
    allWarnings.push(...(result.warnings ?? []));
  }
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    ...(allWarnings.length ? { warnings: allWarnings } : {}),
  };
}
