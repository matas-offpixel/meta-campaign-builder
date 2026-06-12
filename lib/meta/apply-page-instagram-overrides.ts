import type { AdCreativeDraft } from "@/lib/types";

/**
 * Apply `settings.pageInstagramOverrides` to a single creative's identity.
 * Sets both content account id and ads actor id — Phase 3 validates
 * `instagramActorId` when building `object_story_spec.instagram_user_id`.
 */
export function applyPageInstagramOverrideToCreative(
  creative: AdCreativeDraft,
  overrides: Record<string, string> | undefined,
): AdCreativeDraft {
  const pageId = creative.identity?.pageId;
  if (!pageId) return creative;
  const override = overrides?.[pageId];
  if (!override) return creative;

  const identity = creative.identity ?? { pageId, instagramAccountId: "" };
  if (
    identity.instagramAccountId === override &&
    identity.instagramActorId === override
  ) {
    return creative;
  }

  return {
    ...creative,
    identity: {
      ...identity,
      pageId,
      instagramAccountId: override,
      instagramActorId: override,
    },
  };
}

/** Apply all page→IG overrides to a creative list (launch route + wizard sync). */
export function applyPageInstagramOverridesToCreatives(
  creatives: AdCreativeDraft[],
  overrides: Record<string, string> | undefined,
): AdCreativeDraft[] {
  if (!overrides || Object.keys(overrides).length === 0) return creatives;
  return creatives.map((c) => applyPageInstagramOverrideToCreative(c, overrides));
}
