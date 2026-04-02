import type { CampaignDraft, WizardStep } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStep(step: WizardStep, draft: CampaignDraft): ValidationResult {
  switch (step) {
    case 0: return validateAccountSetup(draft);
    case 1: return validateCampaignSetup(draft);
    case 2: return validateOptimisationStrategy(draft);
    case 3: return validateAudiences(draft);
    case 4: return validateCreatives(draft);
    case 5: return validateBudgetSchedule(draft);
    case 6: return validateAssignCreatives(draft);
    case 7: return validateReview(draft);
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
  if (!draft.settings.campaignName.trim()) errors.push("Campaign name is required");
  if (!draft.settings.objective) errors.push("Campaign objective is required");
  if (!draft.settings.optimisationGoal) errors.push("Optimisation goal is required");
  return { valid: errors.length === 0, errors };
}

function validateOptimisationStrategy(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  const strat = draft.optimisationStrategy;
  if (!strat) return { valid: true, errors: [] };
  if (strat.mode === "custom" && strat.rules.length === 0) {
    errors.push("Add at least one rule in custom mode, or switch to benchmarks");
  }
  return { valid: errors.length === 0, errors };
}

function validateAudiences(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  const { audiences } = draft;
  const hasPageGroups = audiences.pageGroups.some((g) => g.pageIds.length > 0);
  const hasCustom = audiences.customAudienceGroups.some((g) => g.audienceIds.length > 0);
  const hasSaved = audiences.savedAudiences.audienceIds.length > 0;
  const hasInterests = audiences.interestGroups.some((g) => g.interests.length > 0);

  if (!hasPageGroups && !hasCustom && !hasSaved && !hasInterests) {
    errors.push("Select at least one audience source");
  }
  return { valid: errors.length === 0, errors };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateCreatives(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  if (draft.creatives.length === 0) {
    errors.push("Add at least one ad");
    return { valid: false, errors };
  }

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
              }
            }
          }
        }
      }
    }

    if (sourceType === "existing_post") {
      if (!c.existingPost?.postId) errors.push(`${label}: Select an existing post`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function validateBudgetSchedule(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  const bs = draft.budgetSchedule;
  if (!bs.budgetAmount || bs.budgetAmount <= 0) {
    errors.push("Budget amount must be greater than 0");
  }
  if (!bs.startDate) errors.push("Start date is required");
  if (!bs.endDate) errors.push("End date is required");
  if (bs.startDate && bs.endDate && bs.startDate >= bs.endDate) {
    errors.push("End date must be after start date");
  }
  return { valid: errors.length === 0, errors };
}

function validateAssignCreatives(draft: CampaignDraft): ValidationResult {
  const errors: string[] = [];
  const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);
  if (enabledSets.length === 0) {
    errors.push("Enable at least one ad set");
  }
  const hasAssignment = Object.values(draft.creativeAssignments).some(
    (creativeIds) => creativeIds.length > 0
  );
  if (!hasAssignment && draft.creatives.length > 0 && enabledSets.length > 0) {
    errors.push("Assign at least one creative to an ad set");
  }
  return { valid: errors.length === 0, errors };
}

function validateReview(draft: CampaignDraft): ValidationResult {
  const allErrors: string[] = [];
  for (let step = 0; step <= 6; step++) {
    const result = validateStep(step as WizardStep, draft);
    allErrors.push(...result.errors);
  }
  return { valid: allErrors.length === 0, errors: allErrors };
}
