import { flattenTikTokInterestGroups } from "../../tiktok-wizard/interest-groups.ts";
import type {
  TikTokCampaignDraft,
  TikTokInterestGroup,
  TikTokTargetingItem,
} from "../../types/tiktok-draft.ts";
import { topVocabularyTerms, type VocabularyTerm } from "./vocabulary.ts";

/** Ad-group / interest-group label the derivation owns. */
export const DERIVED_TIKTOK_GROUP_NAME = "Derived from Meta";

/** Cap the number of seed terms sent to TikTok's recommend endpoint. */
export const TIKTOK_SEED_TERM_LIMIT = 12;

/**
 * TikTok hashtag targeting is a hard launch blocker today:
 * collectTikTokLaunchPreflight emits `hashtag-unverified` whenever any
 * hashtag is present, because TikTok hashtag ids are not verified to share
 * a namespace with interest_keyword_ids. Derivation therefore RETURNS
 * hashtag suggestions (so the operator can see them) but never writes them
 * into the draft — writing them would make every derived draft unlaunchable.
 */
export const TIKTOK_HASHTAG_WITHHELD_REASON =
  "hashtag_targeting_blocks_launch — TikTok preflight rejects any draft carrying hashtags (`hashtag-unverified`), so derived hashtags are shown here but not written into the draft";

export interface TikTokSuggestionCandidate {
  id: string;
  name: string;
  audienceSize?: number | null;
}

export interface DerivedTikTokTerm {
  id: string;
  name: string;
  audienceSize: number | null;
  /** The Meta source this suggestion was seeded from. */
  provenance: string;
  seedTerm: string;
}

export function tiktokSeedTerms(
  vocabulary: VocabularyTerm[],
  limit: number = TIKTOK_SEED_TERM_LIMIT,
): VocabularyTerm[] {
  return topVocabularyTerms(vocabulary, limit);
}

/**
 * Fold raw suggestion rows (from the existing
 * `/api/tiktok/audience/keywords` machinery) into provenance-labelled terms.
 * First seed to surface an id wins, so the label names a real Meta source.
 */
export function collectDerivedTikTokTerms(
  results: Array<{ seed: VocabularyTerm; candidates: TikTokSuggestionCandidate[] }>,
): DerivedTikTokTerm[] {
  const byId = new Map<string, DerivedTikTokTerm>();
  for (const { seed, candidates } of results) {
    for (const candidate of candidates) {
      if (!candidate?.id || !candidate.name?.trim()) continue;
      if (byId.has(candidate.id)) continue;
      byId.set(candidate.id, {
        id: candidate.id,
        name: candidate.name.trim(),
        audienceSize: candidate.audienceSize ?? null,
        provenance: seed.provenance,
        seedTerm: seed.term,
      });
    }
  }
  return [...byId.values()];
}

export function isDerivedTargetingItem(item: TikTokTargetingItem): boolean {
  return typeof item.derivedFrom === "string" && item.derivedFrom.length > 0;
}

export interface MergeDerivedTikTokResult {
  draft: TikTokCampaignDraft;
  added: number;
  keptOperatorItems: number;
  replacedDerivedItems: number;
}

/**
 * Write derived interest keywords into the TikTok draft.
 *
 * Re-derive contract: items the operator picked in the TikTok wizard carry no
 * `derivedFrom` and are never removed or renamed. Only previously derived
 * items are replaced, and a term the operator already owns is not re-added as
 * a derived duplicate.
 */
export function mergeDerivedTikTokInterests(
  draft: TikTokCampaignDraft,
  derived: DerivedTikTokTerm[],
  now: string = new Date().toISOString(),
): MergeDerivedTikTokResult {
  const groups: TikTokInterestGroup[] = (draft.audiences.interestGroups ?? []).map(
    (group) => ({ ...group, interestIds: [...group.interestIds] }),
  );

  const operatorOwnedIds = new Set<string>();
  let keptOperatorItems = 0;
  let replacedDerivedItems = 0;

  for (const group of groups) {
    const kept: TikTokTargetingItem[] = [];
    for (const item of group.interestIds) {
      if (isDerivedTargetingItem(item)) {
        replacedDerivedItems += 1;
        continue;
      }
      operatorOwnedIds.add(item.id);
      keptOperatorItems += 1;
      kept.push(item);
    }
    group.interestIds = kept;
  }

  const newItems: TikTokTargetingItem[] = derived
    .filter((term) => !operatorOwnedIds.has(term.id))
    .map((term) => ({
      id: term.id,
      name: term.name,
      kind: "keyword" as const,
      audienceType: "GENERAL_INTEREST" as const,
      audienceSize: term.audienceSize,
      derivedFrom: term.provenance,
    }));

  let target = groups.find((group) => group.name === DERIVED_TIKTOK_GROUP_NAME);
  if (!target && newItems.length > 0) {
    target = {
      id: crypto.randomUUID(),
      name: DERIVED_TIKTOK_GROUP_NAME,
      interestIds: [],
      hashtagIds: [],
      behaviourIds: [],
    };
    groups.push(target);
  }
  if (target) target.interestIds = [...target.interestIds, ...newItems];

  const flat = flattenTikTokInterestGroups(groups);
  return {
    draft: {
      ...draft,
      lastDerivedAt: now,
      audiences: { ...draft.audiences, interestGroups: groups, ...flat },
    },
    added: newItems.length,
    keptOperatorItems,
    replacedDerivedItems,
  };
}
