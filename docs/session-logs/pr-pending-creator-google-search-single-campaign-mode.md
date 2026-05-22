# PR: feat(creator): single-campaign structure mode (C-codes as ad groups)

**Branch:** `creator/google-search-single-campaign-mode`
**PR:** pending
**Status:** shipped

---

## Problem

The Google Search wizard was hard-coded to create one campaign per C-code (7 campaigns for a J2-style plan). For a single-event plan with a £240 budget, 7 campaigns is heavy:

- 7 separate budgets, each needing individual management
- Fragmented reporting across campaigns
- Siloed spend — no reallocation to best-performing themes

One campaign with many ad groups is the better structure for single events: one budget flows to the best performers, consolidated reporting, and far less management overhead.

---

## Solution

Added a `structure_mode` flag (`"single_campaign"` | `"campaign_per_theme"`) to the plan. Default is `"single_campaign"` for all new plans.

### Key decisions

**Storage:** Real column via migration 097 (`structure_mode TEXT NOT NULL DEFAULT 'single_campaign'`). Chosen over packing into the `geo_targets` jsonb wrapper (where `geo_target_type` lives) because `structure_mode` is conceptually unrelated to geo-targeting and deserves its own CHECK-constrained column. The `DEFAULT 'single_campaign'` means existing rows pick it up without a backfill.

**Negatives handling in single-campaign mode:** Campaign-scoped negatives (e.g., a negative scoped to "C2 Adam Beyer") are *promoted to plan-scoped* in single-campaign mode. Rationale: in a single-campaign plan there is only one campaign, so per-C-code campaign-scope is meaningless. The promotion is logged with `campaign_negative_promoted_to_plan` import warnings so the operator sees what happened. For single events the distinction rarely matters.

**Push adapter:** Requires **zero changes**. The adapter already loops `plan → campaigns → ad_groups`. A single-campaign plan has `campaigns[0]` with N ad groups — the existing generic loop handles it without modification. Confirmed via 4 new push-adapter tests.

---

## Changes

| File | Change |
|------|--------|
| `supabase/migrations/097_google_search_plans_structure_mode.sql` | NEW — adds `structure_mode` column |
| `lib/google-search/types.ts` | Added `STRUCTURE_MODES`, `GoogleSearchStructureMode`, `DEFAULT_STRUCTURE_MODE`; added `structure_mode` field to `GoogleSearchPlan` |
| `lib/google-search/xlsx-import.ts` | Added `restructureAsSingleCampaign()` export; `ParseXlsxOptions.structureMode`; step 6 in parser applies restructure |
| `lib/db/google-search-plans.ts` | `CreatePlanInput` + `createGoogleSearchPlan` + `hydratePlan` + `saveGoogleSearchPlanTree` + `createGoogleSearchPlanTreeFromDraft` all handle `structure_mode` |
| `app/api/google-search/route.ts` | Accepts `structure_mode` in JSON body |
| `app/api/google-search/import/route.ts` | Reads `structure_mode` form field, passes to parser |
| `components/google-search/plan-actions.tsx` | Added Structure toggle (single/per-theme) to the library-page import/create UI |
| `components/google-search-wizard/steps/plan-setup.tsx` | Added Structure Mode card showing and allowing the operator to update the flag |
| `components/google-search-wizard/steps/campaigns.tsx` | Splits into `SingleCampaignView` (one budget input + ad-group list) vs `MultiCampaignView` (original table) based on `structure_mode` |
| `lib/google-search/__tests__/single-campaign-mode.test.ts` | NEW — 22 tests covering parser, restructure, negatives promotion, and push adapter |
| `lib/google-ads/__tests__/campaign-writer.test.ts` + other test fixtures | Added `structure_mode: "single_campaign"` to plan fixtures |

---

## Validation

```
npx tsc --noEmit        — no new errors in our files
npx eslint [paths]      — 0 errors, pre-existing warnings only
node --experimental-strip-types --test [paths]  — 225 pass, 0 fail
npm run build           — clean
```

New tests: 22 pass covering single/per-theme parser, `restructureAsSingleCampaign` unit, negatives promotion, and push adapter structure-mode transparency.

---

## Migration note

Migration 097 must be applied after merge:

```sql
alter table google_search_plans
  add column if not exists structure_mode text not null default 'single_campaign'
    check (structure_mode in ('campaign_per_theme', 'single_campaign'));
```

Existing rows will default to `'single_campaign'`. If any existing plans are multi-campaign-by-design (campaign_per_theme intent), they will need to be manually updated — but as of 2026-05-22 the only live push is J2 PAUSED at 7 campaigns which will be deleted and replaced with a single-campaign version post-merge.

---

## After this merges

1. Re-import the J2 Melodic plan with `single_campaign` mode
2. The resulting plan: one `[UTB0043-New] Search` campaign with ad groups `C1 – Brand`, `C2 – Adam Beyer Tickets`, `C2 – Drumcode London`, `C3 – Miss Monique`, etc.
3. Set one daily budget, push to LWE (PAUSED)
4. Delete the old 7-campaign J2 push (PAUSED, £0)
5. Compare the two structures in the Google Ads UI and confirm consolidation
