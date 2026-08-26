import { fetchTikTokInterestKeywordRecommendations } from "../../tiktok/audience.ts";
import { readTikTokAccountCredentials } from "../../tiktok/api-account.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { loadLinkedMetaDraft } from "../linked-drafts.ts";
import type { CampaignPlan } from "../types.ts";
import {
  collectDerivedTikTokTerms,
  mergeDerivedTikTokInterests,
  tiktokSeedTerms,
  type DerivedTikTokTerm,
  type MergeDerivedTikTokResult,
} from "./tiktok.ts";
import {
  extractMetaVocabulary,
  type PlanEventVocabularyContext,
  type VocabularyTerm,
} from "./vocabulary.ts";

/**
 * Artist names are not joined into the wizard's event context (they live in
 * `artists` / `event_artists`), so the event contributes name, venue and
 * genres only. The Meta draft carries the artist vocabulary via page-group
 * labels and resolved page names.
 */
export async function loadPlanEventVocabularyContext(
  supabase: unknown,
  eventId: string | null,
): Promise<PlanEventVocabularyContext | null> {
  if (!eventId) return null;
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from("events")
    .select("name, venue_name, genres")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    name: (data.name as string | null) ?? null,
    venueName: (data.venue_name as string | null) ?? null,
    genres: Array.isArray(data.genres) ? (data.genres as string[]) : null,
  };
}

export interface PlanVocabularyResult {
  vocabulary: VocabularyTerm[];
  hasMetaDraft: boolean;
}

export async function buildPlanVocabulary(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<PlanVocabularyResult> {
  const metaDraftId = plan.launches.meta.draftId;
  const [draft, event] = await Promise.all([
    metaDraftId
      ? loadLinkedMetaDraft(supabase, metaDraftId, plan.userId)
      : Promise.resolve(null),
    loadPlanEventVocabularyContext(supabase, plan.intent.eventId),
  ]);
  return {
    hasMetaDraft: draft !== null,
    vocabulary: extractMetaVocabulary({
      draft,
      event,
      fallbackCluster: plan.intent.audienceClusterRef,
    }),
  };
}

export type TikTokDerivationOutcome =
  | { ok: true; merged: MergeDerivedTikTokResult; derived: DerivedTikTokTerm[] }
  | { ok: false; reason: string };

/**
 * Feed the Meta vocabulary through the SAME interest-keyword recommend call
 * the TikTok wizard's seed box uses, then merge the results into the draft.
 * A seed that TikTok cannot resolve is skipped, not faked.
 */
export async function deriveTikTokTargeting(
  supabase: unknown,
  input: {
    userId: string;
    draft: TikTokCampaignDraft;
    vocabulary: VocabularyTerm[];
  },
): Promise<TikTokDerivationOutcome> {
  const advertiserId = input.draft.accountSetup?.advertiserId?.trim() || "";
  if (!advertiserId) {
    return {
      ok: false,
      reason:
        "tiktok_advertiser_not_selected — pick the advertiser in the TikTok wizard first; interest suggestions are advertiser-scoped",
    };
  }

  const credentials = await readTikTokAccountCredentials(supabase as never, {
    userId: input.userId,
    advertiserId,
  });
  if (!credentials) {
    return {
      ok: false,
      reason: "tiktok_credentials_missing — reconnect the TikTok account",
    };
  }

  const seeds = tiktokSeedTerms(input.vocabulary);
  if (seeds.length === 0) {
    return {
      ok: false,
      reason:
        "no_meta_vocabulary — the Meta draft has no page groups, interests or event names to derive from yet",
    };
  }

  const results = await Promise.all(
    seeds.map(async (seed) => {
      try {
        const candidates = await fetchTikTokInterestKeywordRecommendations({
          advertiserId,
          token: credentials.accessToken,
          keyword: seed.term,
          limit: 5,
        });
        return { seed, candidates };
      } catch {
        return { seed, candidates: [] };
      }
    }),
  );

  const derived = collectDerivedTikTokTerms(results);
  return {
    ok: true,
    derived,
    merged: mergeDerivedTikTokInterests(input.draft, derived),
  };
}
