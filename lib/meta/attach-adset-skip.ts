/**
 * Phase 2 skip-guard for launch-campaign — extracted for unit testability
 * (mirrors the `assertSameObjective` extraction pattern from PR #596).
 *
 * Bug (task #113): `attach_all_adsets` launches were duplicating ad sets.
 * Phase 2 of `launch-campaign/route.ts` only special-cased `wizardMode ===
 * "attach_adset"` when deciding whether `standardSets`/`lookalikeSets` should
 * be empty and whether `adSetCreationPromise` should run. `attach_all_adsets`
 * fell through: Phase 2 (lines ~2559-2609) already fetches every live ad set
 * across the selected campaigns and seeds `adSetMetaIds` with synthetic keys,
 * but `adSetCreationPromise` then ALSO ran against `draft.adSetSuggestions`
 * (the wizard's own Step-5 ad-set definitions, always present in the draft),
 * creating brand-new ad sets on top of the live ones. Every re-launch doubled
 * the ad-set count.
 *
 * Reproducer: East End Dubs Newcastle signup campaign
 * (act 606252931141334, campaign 120251160301180755) — 27 ad sets, half
 * auto-duplicated by the wizard on the last `attach_all_adsets` launch.
 *
 * Same root cause, same fix shape as the earlier `attach_adset` fix
 * (docs/session-logs/pr-609-cursor-pr605-attach-adset-skip-phase-2-creation.md,
 * subcode=1885621 CBO reproducer) — that fix only covered `attach_adset`.
 */

import type { WizardMode } from "@/lib/types";

/**
 * True when Phase 2 should skip ad-set creation entirely because the ad
 * sets ads will be attached to already exist in Meta:
 *
 * - `"attach_adset"` — the user hand-picked one or more live ad sets in
 *   Step 1; synthetic keys for them are seeded before this guard runs.
 * - `"attach_all_adsets"` — Phase 2 already fetched every active/paused ad
 *   set across the selected campaigns and seeded synthetic keys for them.
 *
 * `"new"` and `"attach_campaign"` both still need Phase 2 to create ad
 * sets — `"new"` from scratch, `"attach_campaign"` because it attaches a
 * brand-new ad set under each existing campaign.
 */
export function shouldSkipAdSetCreation(wizardMode: WizardMode): boolean {
  return wizardMode === "attach_adset" || wizardMode === "attach_all_adsets";
}
