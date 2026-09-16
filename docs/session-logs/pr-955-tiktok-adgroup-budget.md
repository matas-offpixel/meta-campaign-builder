# Session log — TikTok ad-group budget

## PR

- **Number:** 955
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/955
- **Branch:** `cursor/tiktok-adgroup-budget`

## Summary

Imported ad groups keep their own budget, so raising the campaign amount
cannot clear launch preflight. Assign now edits `budgetSchedule.adGroups[i].budget`
on blur (task #139), shows TikTok's floor on that field, and offers a
per-ad-group "Set to £N" that writes only on click.

The "(2 ad groups) — London" suffix was one ad group emitting twice (explicit
floor check + `buildTikTokAdGroupPayload` budget error), not a duplicated
list. Preflight no longer re-emits the payload budget error; collapse counts
`memberIds`, and drops the parenthetical when that is 1.

## Scope / files

- `components/tiktok-wizard/steps/assign-creatives.tsx` — budget input, floor, match
- `lib/tiktok-wizard/ad-group-budget.ts` — patch / floor line / match copy
- `lib/tiktok/write/preflight.ts` — skip duplicate budget emit; count names
- Tests: `937e9b11` shape, blur pin, floor, no silent campaign raise, collapse

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6012 pass, 0 fail, 4 skipped

## Notes

- `resolveTikTokAdGroupBudget` precedence unchanged. No auto-raise on
  reconcile, campaign-budget change, or load. Mapping still enforces the
  floor on write.
