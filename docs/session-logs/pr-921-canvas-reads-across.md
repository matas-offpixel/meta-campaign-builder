# Session log

## PR

- **Number:** 921
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/921
- **Branch:** `cursor/canvas-reads-across`

## Summary

The canvas reads across. `ad_plans` owns the money, the day grid and the ticket target; `campaign_plans` owns the launch. Folamour no longer draws £0 as if it were the campaign — the budget zone shows the campaign total, this phase's daily × inclusive days, and signed unallocated. The ticket target sits beside the paid-media projection with no shortfall arithmetic. `/plan/new` requires a phase and offers an existing plan instead of a raw unique-violation.

## Scope / files

- `lib/plan/ad-plan-read.ts` — campaign / phase / unallocated lines, ticket-target line, existing-phase offer
- `lib/plan/ad-plan-load.ts` — server read of `ad_plans` + sibling `campaign_plans`
- `lib/plan/phase-reconcile.ts` — comment only; helper already tested in #919
- `components/plan/canvas-budget.tsx` — three plain lines when `readAcross` is passed (frames omit it)
- `components/plan/canvas-target.tsx` — ticket target beside the projection chip
- `components/plan/plan-workspace.tsx` — wires the read, phase picker, offer, persist gates
- `app/(dashboard)/plan/[id]/page.tsx` + `lib/plan/share-load.ts` — load ad plans and siblings
- `lib/plan/persist.ts` + `app/api/plan/route.ts` — write `phase` when set; 409 → offer sentence
- `lib/plan/types.ts` / `empty-plan.ts` / `persist-policy.ts` / `event-picker.ts` — optional `phase`, `soldOutAt`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5438 pass, 4 skipped)
- [x] `npm run frames:check` — local darwin diffs against Ubuntu rasters (height mismatch = 100%). No baselines regenerated. Frame mount still omits `readAcross` / `campaignTarget`, so Ubuntu CI should stay still. If CI names a frame, stop.

## Notes

- No frame ids regenerated. The new lines are live-canvas only. Unexpected CI diffs should not be papered over from this machine.
- `ad_plans` is read only. No G34 change. D.O.D phase stays null. `ENABLE_PLAN_FANOUT` and `OFFPIXEL_TIKTOK_WRITES_ENABLED` unchanged. No launch caller.
- Unallocated is signed. Over-commit is drawn, not an error.
- §4.8b guard: the face never subtracts ticket target from the projection.
