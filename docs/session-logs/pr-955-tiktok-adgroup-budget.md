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
list. Preflight no longer re-emits the payload budget error when
`adgroup-budget-*` / `adgroup-budget-floor-*` for that id is already in
`issues`; collapse counts `memberIds`, and drops the parenthetical when
that is 1.

Round 2: the write-path guard keeps `preflight.ts` in scope. A companion
pins three hunks (skip-helper import, already-reported skip, collapse
counting) so a fourth change to that file still fails. Persist-on-blur
is a tested policy; Assign is grepped only for wiring. Assign memoises
collect on id+budget plus the floor inputs so a name keystroke does not
rebuild every payload. `budgetDraft` is seeded once on purpose.

## Scope / files

- `components/tiktok-wizard/steps/assign-creatives.tsx` — budget input, floor, match
- `lib/tiktok-wizard/ad-group-budget.ts` — patch / floor line / match copy / skip / persist
- `lib/tiktok/write/preflight.ts` — skip duplicate budget emit; count names
- `lib/plan/__tests__/drawer.test.ts` — write-path guard companion
- Tests: `937e9b11` shape, blur pin, floor, no silent campaign raise, collapse

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6017 pass, 0 fail, 4 skipped

## Notes

- `resolveTikTokAdGroupBudget` precedence unchanged. No auto-raise on
  reconcile, campaign-budget change, or load. Mapping still enforces the
  floor on write.
- The third preflight hunk is the import of
  `shouldSkipDuplicateTikTokAdGroupBudgetPayload`. The skip is keyed on
  already-reported issue ids, not on `field === "budget"`.
- `budgetDraft` is seeded once; reconciliation while Assign is open
  leaves a stale box, same as Review's schedule fields (#954).
