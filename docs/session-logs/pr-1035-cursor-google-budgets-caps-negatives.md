# Google launcher v2 — PR 1: budgets, CPC caps, bid floor, negatives

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/google-budgets-caps-negatives`

## Summary

The plan budget now reaches Google. Before this, a campaign with no budget of its own was pushed at a flat £5/day. Every Maximise Clicks campaign went out with a £2.00 ceiling whatever its sheet cap said. Every ad-group bid under £1 was raised to £1, because the bid used the daily-budget floor. In single-campaign mode, campaign-scoped competitor negatives were promoted to plan scope, which put them on the conquest ad groups that bid on those competitors.

- **Budget:** `plan.daily_budget` = `total_budget` ÷ inclusive days (migration 188). A campaign with no budget of its own gets an even share of it across the campaigns that serve. Review hard-blocks the £5 last resort, and blocks campaign spend more than 10% over the plan.
- **CPC ceiling:** the ceiling is the sheet cap.
- **Bid floor:** ad-group bids floor at 1p.
- **Negatives:** single-mode campaign negatives become ad-group negatives on that campaign's ad groups. Review hard-blocks any negative that would block one of the plan's own keywords.

No live Google campaign is touched and nothing is backfilled to Google.

## Scope / files

- `supabase/migrations/188_google_search_plan_budget_and_ad_group_negatives.sql`:
  - `google_search_plans.daily_budget` and `pacing` (`even` | `front_loaded` | `phased`, default `even`).
  - `google_search_negatives.ad_group_id`.
  - Unapplied. Apply prod first, then CI, before merge.
- `lib/google-search/budget.ts` (new): plan daily budget and the per-campaign budget resolution order. Shared by Review, validation and the writer.
- `lib/google-search/bids.ts` (new):
  - CPC ceiling from `max_cpc_cap`, else £2.00.
  - Ad-group bid from `default_cpc`, floored at `MIN_CPC_BID_MICROS = 10_000`.
- `lib/google-search/negative-conflicts.ts` (new): Google negative matching (see Notes) and the conflict finder.
- `lib/google-search/push-preview.ts` (new): one Review row per campaign (£/day, where it came from, CPC ceiling).
- `lib/google-ads/campaign-writer.ts`:
  - The budget op uses the plan tree.
  - The ceiling comes from the cap and the bid uses the 1p floor.
  - Negatives are collected per ad group (plan + campaign + this ad group).
- `lib/google-search/xlsx-import.ts`:
  - Reads `Cap (£) A → B` / `Cap (£) A/B → C` and phased string cells.
  - Reads the "Budget & Phasing" total.
  - The plan window runs from the first start to the last end when campaigns differ.
  - Single mode creates ad-group negatives, and the merged campaign takes the plan daily budget and the highest source cap.
  - Stale header and warning text fixed.
- `lib/google-search/validation.ts`:
  - New errors: `budget_fallback_daily`, `budget_exceeds_plan`, `negative_blocks_keyword`.
  - The soft `keyword_cannibalised_by_negative` warning is replaced by `negative_blocks_keyword`.
- `lib/db/google-search-plans.ts`: writes `daily_budget` and `pacing`, reads and writes `ad_group_id`, and coerces PostgREST numeric strings.
- `lib/plan/adapters/google.ts`, `lib/plan/derive/google.ts`, `app/api/plan/preflight/route.ts`: the canvas adapter now stores daily × days in `total_budget`. Before, it stored the daily figure, which would trip the overspend blocker.
- `components/google-search-wizard/steps/plan-setup.tsx`: read-only "≈ £X/day".
- `components/google-search-wizard/steps/push.tsx`: per-campaign £/day and CPC ceiling.
- `lib/google-search/__tests__/fixtures/`: IRW0001 Jamie Jones, IRW0004 CamelPhat and IRW0005 Appetite build sheets.

## Validation

- [x] `npx tsc --noEmit` (no new errors vs `main`)
- [x] `npm run build`
- [x] `npm test` — 6987 tests, 0 failures. Acceptance tests are in `launcher-v2-budgets-caps-negatives.test.ts`, and the writer payload snapshots are in `campaign-writer.test.ts`.

## Notes

**Why the CamelPhat and Appetite caps were missing:**

- The Campaigns-tab reader only looked for a `Max CPC cap` / `Max CPC` header. CamelPhat's header is `Cap (£) A → B` and Appetite's is `Cap (£) A/B → C`.
- The cells are phased strings (`"0.80 → 1.10"`). Even if the header had matched, `numericOrNull` would have stripped them to `0.801.10` and returned null.
- Jamie Jones has a numeric `Max CPC cap (£)` column, which is why its caps were stored.
- A phased cap launches on its first value; every phase is kept in `bid_adjustments.max_cpc_cap_phases`.

**Negative matching rule.** The keyword's text is treated as the search, and tokens compare exactly with no close variants.
- Broad: every negative word appears, in any order.
- Phrase: the words appear contiguously and in order.
- Exact: the whole keyword equals the negative.

**Appetite `costume`:**
- The sheet scopes `costume` / `costumes` / `fancy dress` (phrase) to C1, C2, C4 and C5, not C3. C3 "Dress-Up / Costume Party" holds `costume party london`.
- Scoped correctly there is no conflict.
- The conflict appears once the negatives are widened to plan scope, which is what the old single-mode import did (prod draft `67b78ba1` has 283 plan negatives). The validator now hard-blocks that case, and the import no longer creates it.

**Prod:** neither pushed plan (CamelPhat `7c3cd282`, Appetite `6b6b96e2`) has a negative that blocks its own keywords. Nothing was written to prod.

**Additions beyond the brief:**
- Reading the sheet total.
- The `ad_group_id` column.
- The plan window as first start → last end.
- The canvas `total_budget` fix.
