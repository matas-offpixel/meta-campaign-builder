/**
 * lib/google-search/negative-conflicts.ts
 *
 * A negative that blocks one of the plan's own keywords.
 *
 * The rule is Google's negative-keyword matching, applied to the
 * keyword's text as if it were the search. Negatives do not expand to
 * close variants, so tokens compare exactly (case-insensitive; `costume`
 * does not block `costumes`).
 *   - Negative broad:  every negative word appears in the keyword, any order.
 *   - Negative phrase: the negative words appear in the keyword, in order,
 *                      with nothing between them.
 *   - Negative exact:  the keyword is exactly the negative words.
 *
 * Severity (`neverServes`): a broad or phrase negative that matches the
 * keyword's text matches every longer query too, so the keyword never
 * serves. An exact negative only blocks the one query; a phrase or broad
 * keyword still serves longer queries, so that pair is a warning. Against
 * an exact keyword it never serves.
 *
 * Scope: a plan negative is checked against every keyword; a campaign
 * negative against that campaign's keywords; an ad-group negative against
 * that ad group's keywords.
 *
 * Re-push (`createdByPush`): the writer only sends rows without a
 * `pushed_resource_name`, and only sends unpushed negatives to a new ad
 * group. A pair the push does not create is already on Google (or never
 * will be) and is left out of Review's blockers:
 *   - negative not yet pushed → push sends it to the ad group: created.
 *   - negative pushed, keyword new, ad group already pushed → the new
 *     keyword lands under the live negative: created.
 *   - otherwise not created.
 */

import type {
  GoogleSearchMatchType,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
} from "./types.ts";

export interface NegativeKeywordConflict {
  negative: string;
  negativeMatchType: GoogleSearchMatchType;
  negativeScope: "plan" | "campaign" | "ad_group";
  keyword: string;
  keywordMatchType: GoogleSearchMatchType;
  campaignName: string;
  adGroupName: string;
  /** False only for an exact negative on a phrase/broad keyword. */
  neverServes: boolean;
  /** False when this push neither sends the negative nor the keyword under it. */
  createdByPush: boolean;
}

/**
 * Ad-group negatives whose ad group is no longer in their campaign. Save
 * and derive both drop these (and say so) rather than widen them to the
 * whole campaign.
 */
export function orphanedAdGroupNegatives(
  tree: Pick<GoogleSearchPlanTree, "campaigns">,
): GoogleSearchNegative[] {
  return tree.campaigns.flatMap((campaign) => {
    const adGroupIds = new Set(campaign.ad_groups.map((ag) => ag.id));
    return campaign.negatives.filter((n) => n.ad_group_id && !adGroupIds.has(n.ad_group_id));
  });
}

export function matchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[+"[\]]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function negativeBlocksKeyword(
  negative: { keyword: string; match_type: GoogleSearchMatchType },
  keywordText: string,
): boolean {
  const neg = matchTokens(negative.keyword);
  const kw = matchTokens(keywordText);
  if (neg.length === 0 || kw.length === 0) return false;
  switch (negative.match_type) {
    case "BROAD": {
      const present = new Set(kw);
      return neg.every((token) => present.has(token));
    }
    case "PHRASE": {
      for (let start = 0; start + neg.length <= kw.length; start += 1) {
        if (neg.every((token, offset) => kw[start + offset] === token)) return true;
      }
      return false;
    }
    case "EXACT":
      return neg.length === kw.length && neg.every((token, i) => kw[i] === token);
    default:
      return false;
  }
}

export function findNegativeKeywordConflicts(
  tree: Pick<GoogleSearchPlanTree, "campaigns" | "plan_negatives">,
): NegativeKeywordConflict[] {
  const out: NegativeKeywordConflict[] = [];
  for (const campaign of tree.campaigns) {
    for (const adGroup of campaign.ad_groups) {
      const scoped: Array<{ negative: GoogleSearchNegative; scope: NegativeKeywordConflict["negativeScope"] }> = [
        ...tree.plan_negatives.map((negative) => ({ negative, scope: "plan" as const })),
        ...campaign.negatives
          .filter((negative) => !negative.ad_group_id || negative.ad_group_id === adGroup.id)
          .map((negative) => ({
            negative,
            scope: negative.ad_group_id ? ("ad_group" as const) : ("campaign" as const),
          })),
      ];
      for (const keyword of adGroup.keywords) {
        for (const { negative, scope } of scoped) {
          if (!negativeBlocksKeyword(negative, keyword.keyword)) continue;
          const createdByPush =
            !negative.pushed_resource_name ||
            (!keyword.pushed_resource_name && Boolean(adGroup.pushed_resource_name));
          out.push({
            negative: negative.keyword,
            negativeMatchType: negative.match_type,
            negativeScope: scope,
            keyword: keyword.keyword,
            keywordMatchType: keyword.match_type,
            campaignName: campaign.name,
            adGroupName: adGroup.name,
            neverServes: negative.match_type !== "EXACT" || keyword.match_type === "EXACT",
            createdByPush,
          });
        }
      }
    }
  }
  return out;
}
