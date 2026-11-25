/**
 * lib/wizard/follow-audience-groups.ts
 *
 * Ad sets after an audience-group edit, the way Step 5's Generate builds
 * them (generateSuggestions), without throwing away the operator's work on
 * the rows that are still right:
 *
 *   - a row whose source group is gone (removed, or merged into another)
 *     goes;
 *   - a row whose group is still there is kept as it is (name, budget, age,
 *     Advantage+, locations, enabled), with Generate's source line
 *     ("Tech house (12 interests)") brought up to date;
 *   - a group this edit made or changed that has no row gets Generate's
 *     rows for it (one per picker tier), each at the "+ Blank ad set"
 *     default budget (defaultBlankAdSetBudget), as a lifetime share on a
 *     lifetime draft;
 *   - blank rows (no source) are never touched.
 *
 * Generate itself replaces every row. This keeps what Generate would keep
 * and changes only what the edit changed. Shared by the MCP's
 * set_draft_audiences. Relative imports only (node:test).
 */
import type { AdSetSuggestion, AudienceSettings, LocationTargetingGroup } from "../types.ts";
import { UK_NATIONWIDE_FALLBACK, defaultBlankAdSetBudget } from "./adset-suggestions.ts";
import { generateSuggestions } from "./generate-adset-suggestions.ts";

export type AudienceGroupKind = "page" | "custom" | "interest";

/** "interest:ig_123": a group as an edit names it. */
export const groupKey = (kind: AudienceGroupKind, id: string) => `${kind}:${id}`;

/** The group a row comes from, as a groupKey, or null for rows with no group (blank, saved audiences, selected-pages lookalikes). */
export function rowGroupKey(row: Pick<AdSetSuggestion, "sourceType" | "sourceId">): string | null {
  switch (row.sourceType) {
    case "page_group":
    case "lookalike_group":
      return groupKey("page", row.sourceId);
    case "custom_group":
    case "custom_group_lookalike":
      return groupKey("custom", row.sourceId);
    case "interest_group":
      return groupKey("interest", row.sourceId);
    default:
      return null;
  }
}

function groupKeys(a: AudienceSettings): Set<string> {
  return new Set([
    ...a.pageGroups.map((g) => groupKey("page", g.id)),
    ...a.customAudienceGroups.map((g) => groupKey("custom", g.id)),
    ...a.interestGroups.map((g) => groupKey("interest", g.id)),
  ]);
}

const sameSource = (a: AdSetSuggestion, b: AdSetSuggestion) =>
  a.sourceType === b.sourceType && a.sourceId === b.sourceId && (a.lookalikeRange ?? null) === (b.lookalikeRange ?? null);

export interface FollowResult {
  adSets: AdSetSuggestion[];
  added: AdSetSuggestion[];
  removed: AdSetSuggestion[];
}

export function followAudienceGroups(
  rows: readonly AdSetSuggestion[],
  audiences: AudienceSettings,
  locationGroups: LocationTargetingGroup[],
  budget: { budgetType: "daily" | "lifetime"; budgetAmount: number },
  touched: ReadonlySet<string>,
): FollowResult {
  const present = groupKeys(audiences);
  const generated = generateSuggestions(audiences, 0, locationGroups, UK_NATIONWIDE_FALLBACK);

  const removed: AdSetSuggestion[] = [];
  const kept: AdSetSuggestion[] = [];
  for (const row of rows) {
    const key = rowGroupKey(row);
    if (key && !present.has(key)) {
      removed.push(row);
      continue;
    }
    const fresh = generated.find((g) => g.id === row.id) ?? generated.find((g) => sameSource(g, row));
    kept.push(fresh && fresh.sourceName !== row.sourceName ? { ...row, sourceName: fresh.sourceName } : row);
  }

  const added: AdSetSuggestion[] = [];
  let out = [...kept];
  for (const g of generated) {
    const key = rowGroupKey(g);
    if (!key || !touched.has(key)) continue;
    if (out.some((r) => sameSource(r, g))) continue;
    const budgetRows = budget.budgetType === "lifetime" ? out.map((r) => ({ ...r, budgetPerDay: r.budgetLifetime ?? 0 })) : out;
    const each = defaultBlankAdSetBudget(budgetRows, budget.budgetAmount);
    const row: AdSetSuggestion = budget.budgetType === "lifetime" ? { ...g, budgetPerDay: 0, budgetLifetime: each } : { ...g, budgetPerDay: each };
    added.push(row);
    out = [...out, row];
  }
  return { adSets: out, added, removed };
}
