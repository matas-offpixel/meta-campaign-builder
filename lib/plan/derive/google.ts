import type {
  GoogleSearchKeyword,
  GoogleSearchNegative,
  GoogleSearchPlanDraftTree,
  GoogleSearchPlanTree,
} from "../../google-search/types.ts";
import { topVocabularyTerms, type VocabularyTerm } from "./vocabulary.ts";

/**
 * Sentinel on `google_search_keywords.notes` / `google_search_negatives.reason`.
 * Provenance lives in an existing text column on purpose — derived-vs-operator
 * tracking needs no migration.
 */
export const GOOGLE_DERIVED_NOTE_PREFIX = "plan-derived:";

export const GOOGLE_SEED_TERM_LIMIT = 20;

/**
 * The standard noise negatives the existing advisory already tells operators
 * to add — verbatim from docs/GOOGLE_SEARCH_PLAN_PREFLIGHT_CHECKLIST.md
 * ("Standard negatives to always include"). validateGoogleSearchPlan's
 * `campaign_no_negatives` warning points at the same idea with two examples;
 * this is the full documented list, not a new invention.
 */
export const GOOGLE_NOISE_NEGATIVES = [
  "free",
  "free tickets",
  "torrent",
  "youtube",
  "mix",
  "spotify",
  "soundcloud",
  "download",
  "stream",
  "wiki",
  "biography",
  "interview",
] as const;

export function derivedNote(provenance: string): string {
  return `${GOOGLE_DERIVED_NOTE_PREFIX} ${provenance}`;
}

export function isDerivedGoogleNote(note: string | null | undefined): boolean {
  return (note ?? "").trimStart().startsWith(GOOGLE_DERIVED_NOTE_PREFIX);
}

export interface DerivedGoogleKeyword {
  keyword: string;
  match_type: GoogleSearchKeyword["match_type"];
  notes: string;
  provenance: string;
}

/**
 * Vocabulary → seed keywords, one PHRASE keyword per term.
 *
 * The keyword text is the vocabulary term verbatim. No suffixes such as
 * "tickets" are appended: that would be a search term nobody in this plan
 * actually expressed, and inventing keywords is exactly what the Google
 * adapter refuses to do. The operator adds intent modifiers in the Search
 * wizard, where volume and CPC estimates are visible.
 */
export function deriveGoogleKeywords(
  vocabulary: VocabularyTerm[],
  limit: number = GOOGLE_SEED_TERM_LIMIT,
): DerivedGoogleKeyword[] {
  const seeds = topVocabularyTerms(vocabulary, limit).filter(
    (term) => term.origin !== "meta_interest_group" && term.origin !== "meta_campaign",
  );
  return seeds.map((term) => ({
    keyword: term.term.toLowerCase(),
    match_type: "PHRASE" as const,
    notes: derivedNote(term.provenance),
    provenance: term.provenance,
  }));
}

export function deriveGoogleNoiseNegatives(): Array<{
  keyword: string;
  match_type: GoogleSearchNegative["match_type"];
  reason: string;
}> {
  return GOOGLE_NOISE_NEGATIVES.map((keyword) => ({
    keyword,
    match_type: "PHRASE" as const,
    reason: derivedNote("standard noise negative (preflight checklist)"),
  }));
}

/**
 * Adapt the plan-shaped tree to the insert-shaped draft tree that
 * `createGoogleSearchPlanTreeFromDraft` accepts: DB-assigned ids and
 * timestamps come off, and plan/campaign negatives collapse into one list
 * carrying an explicit scope.
 */
export function toGoogleSearchPlanDraftTree(
  tree: GoogleSearchPlanTree,
): GoogleSearchPlanDraftTree {
  return {
    plan: {
      event_id: tree.plan.event_id,
      google_ads_account_id: tree.plan.google_ads_account_id,
      name: tree.plan.name,
      status: tree.plan.status,
      total_budget: tree.plan.total_budget,
      bidding_strategy: tree.plan.bidding_strategy,
      structure_mode: tree.plan.structure_mode,
      geo_targets: tree.plan.geo_targets,
      geo_target_type: tree.plan.geo_target_type,
      date_range: tree.plan.date_range,
    },
    campaigns: tree.campaigns.map((campaign) => ({
      name: campaign.name,
      priority: campaign.priority,
      monthly_budget: campaign.monthly_budget,
      daily_budget: campaign.daily_budget,
      bid_adjustments: campaign.bid_adjustments,
      notes: campaign.notes,
      sort_order: campaign.sort_order,
      ad_groups: campaign.ad_groups.map((adGroup) => ({
        name: adGroup.name,
        default_cpc: adGroup.default_cpc,
        sort_order: adGroup.sort_order,
        keywords: adGroup.keywords.map((keyword) => ({
          keyword: keyword.keyword,
          match_type: keyword.match_type,
          est_cpc_low: keyword.est_cpc_low,
          est_cpc_high: keyword.est_cpc_high,
          intent: keyword.intent,
          notes: keyword.notes,
        })),
        rsas: adGroup.rsas.map((rsa) => ({
          headlines: rsa.headlines,
          descriptions: rsa.descriptions,
          final_url: rsa.final_url,
          path1: rsa.path1,
          path2: rsa.path2,
        })),
      })),
    })),
    negatives: [
      ...tree.plan_negatives.map((negative) => ({
        keyword: negative.keyword,
        match_type: negative.match_type,
        reason: negative.reason,
        scope: { kind: "plan" as const },
      })),
      ...tree.campaigns.flatMap((campaign) =>
        campaign.negatives.map((negative) => ({
          keyword: negative.keyword,
          match_type: negative.match_type,
          reason: negative.reason,
          scope: { kind: "campaign" as const, campaign_name: campaign.name },
        })),
      ),
    ],
    sitelinks: tree.sitelinks.map((sitelink) => ({
      link_text: sitelink.link_text,
      final_url: sitelink.final_url,
      description1: sitelink.description1,
      description2: sitelink.description2,
      sort_order: sitelink.sort_order,
    })),
    warnings: [],
  };
}

export interface MergeDerivedGoogleResult {
  tree: GoogleSearchPlanTree;
  addedKeywords: number;
  keptOperatorKeywords: number;
  replacedDerivedKeywords: number;
  addedNegatives: number;
  lastDerivedAt: string | null;
}

export const GOOGLE_LAST_DERIVED_KEY = "plan_last_derived_at";

export function googleLastDerivedAt(tree: GoogleSearchPlanTree): string | null {
  const stamped = tree.campaigns[0]?.bid_adjustments?.[GOOGLE_LAST_DERIVED_KEY];
  if (typeof stamped === "string" && stamped.trim()) return stamped;
  const stamps: string[] = [];
  for (const campaign of tree.campaigns) {
    for (const group of campaign.ad_groups) {
      for (const keyword of group.keywords) {
        if (isDerivedGoogleNote(keyword.notes) && keyword.created_at) {
          stamps.push(keyword.created_at);
        }
      }
    }
  }
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}

/**
 * Write derived seed keywords + noise negatives into the first ad group of
 * the plan tree.
 *
 * Re-derive contract: a keyword whose `notes` lacks the derived sentinel was
 * written or edited by the operator in the Search wizard and is never
 * removed. Only previously derived rows are replaced, and a term the operator
 * already owns is not re-added.
 */
export function mergeDerivedGoogleKeywords(
  tree: GoogleSearchPlanTree,
  derived: DerivedGoogleKeyword[],
  negatives: Array<{ keyword: string; match_type: GoogleSearchNegative["match_type"]; reason: string }> = [],
): MergeDerivedGoogleResult {
  const campaign = tree.campaigns[0];
  const adGroup = campaign?.ad_groups[0];
  if (!campaign || !adGroup) {
    return {
      tree,
      addedKeywords: 0,
      keptOperatorKeywords: 0,
      replacedDerivedKeywords: 0,
      addedNegatives: 0,
      lastDerivedAt: googleLastDerivedAt(tree),
    };
  }

  const now = new Date().toISOString();
  const operatorKeywords = adGroup.keywords.filter((row) => !isDerivedGoogleNote(row.notes));
  const replacedDerivedKeywords = adGroup.keywords.length - operatorKeywords.length;
  const operatorOwned = new Set(
    operatorKeywords.map((row) => row.keyword.trim().toLowerCase()),
  );

  const newKeywords: GoogleSearchKeyword[] = derived
    .filter((row) => !operatorOwned.has(row.keyword.trim().toLowerCase()))
    .map((row) => ({
      id: crypto.randomUUID(),
      ad_group_id: adGroup.id,
      keyword: row.keyword,
      match_type: row.match_type,
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: row.notes,
      pushed_resource_name: null,
      created_at: now,
    }));

  const existingNegatives = new Set(
    tree.plan_negatives.map((row) => row.keyword.trim().toLowerCase()),
  );
  const newNegatives: GoogleSearchNegative[] = negatives
    .filter((row) => !existingNegatives.has(row.keyword.trim().toLowerCase()))
    .map((row) => ({
      id: crypto.randomUUID(),
      plan_id: tree.plan.id,
      campaign_id: null,
      keyword: row.keyword,
      match_type: row.match_type,
      reason: row.reason,
      pushed_resource_name: null,
      created_at: now,
    }));

  return {
    tree: {
      ...tree,
      campaigns: tree.campaigns.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              bid_adjustments: {
                ...entry.bid_adjustments,
                [GOOGLE_LAST_DERIVED_KEY]: now,
              },
              ad_groups: entry.ad_groups.map((group, groupIndex) =>
                groupIndex === 0
                  ? { ...group, keywords: [...operatorKeywords, ...newKeywords] }
                  : group,
              ),
            }
          : entry,
      ),
      plan_negatives: [...tree.plan_negatives, ...newNegatives],
    },
    addedKeywords: newKeywords.length,
    keptOperatorKeywords: operatorKeywords.length,
    replacedDerivedKeywords,
    addedNegatives: newNegatives.length,
    lastDerivedAt: now,
  };
}
