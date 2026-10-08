/**
 * lib/google-search/negative-conflicts.ts
 *
 * A negative that blocks one of the plan's own keywords. Review
 * hard-blocks every pair this finds.
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
 * Scope: a plan negative is checked against every keyword; a campaign
 * negative against that campaign's keywords; an ad-group negative against
 * that ad group's keywords.
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
  campaignName: string;
  adGroupName: string;
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
          out.push({
            negative: negative.keyword,
            negativeMatchType: negative.match_type,
            negativeScope: scope,
            keyword: keyword.keyword,
            campaignName: campaign.name,
            adGroupName: adGroup.name,
          });
        }
      }
    }
  }
  return out;
}
