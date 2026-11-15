# Session log

## PR

- **Number:** 1066
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1066
- **Branch:** `cursor/mml-wizard-r4`

## Summary

Step 6 of the MML wizard is the Meta creator's budget and schedule step, with an editable outlet split above it. TikTok's share plans one regional ad group until it can fund a second, then adds nationwide UK. The floor is TikTok's live GBP minimum of £50 a day per ad group, not the recalled £20.

## Scope / files

- `lib/plan/mml-budget.ts` — split edits, blockers, TikTok ad-group plan
- `lib/plan/adapters/tiktok.ts` — patch an existing draft's budget, schedule, and ad groups
- `lib/plan/adapters/google.ts` — write the Search plan's budget columns and resolved locations
- `components/wizard/mml-step-budget.tsx` — split card and the Review budget list
- `components/wizard/mml-wizard.tsx` — mounts the creator budget step under the split
- `components/wizard/mml-step-audiences.tsx` — step 4 TikTok line follows the plan

## Validation

- [x] `npx tsc --noEmit` (no new errors in touched files; the full check still exits with existing errors elsewhere)
- [x] `npm run build`
- [x] `npm test` — 7375 passed, 4 skipped, plus 8 vitest

## Notes

TikTok's write path refuses a GBP ad group under £50 (`TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY`, live 40002 on advertiser 7639802149165301776). Nationwide starts at £100/day. A share under £50 is not written onto the TikTok draft. Lifetime minimum is £50 × scheduled days.

Folamour's event has no Google Ads customer, so step 1 does not select Google. The 80/15/5 preset therefore lands as 80/20 (Meta keeps 80, TikTok takes the rest). TikTok at £45/day stays blocked, with Raise to £50/day or Turn TikTok off. Both edits reloaded at the same figures. The plan was put back to its previous £0 split after the check. Nothing was launched.
