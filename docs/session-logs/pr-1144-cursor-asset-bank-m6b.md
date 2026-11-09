# Session log

## PR

- **Number:** 1144
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1144
- **Branch:** `cursor/asset-bank-m6b`

## Summary

Asset bank issue 3 (H12–H16). The roll-call is a `roll_call` rung whose two lines come from the event's releases, and it is proposed ahead of a % rung for the same release. Four derived rungs sit under it. An offer is entered on its own sheet and table, never on the ladder. A cancelled event keeps its rows and mounts nothing. A backfilled row stays plain until the first tap.

## Scope / files

- `supabase/migrations/221_asset_bank_m6b_kinds.sql` — the five enum values only. Not applied.
- `supabase/migrations/222_asset_bank_m6b.sql` — the roll-call update, rungs 11–14, `event_offers`. Not applied.
- sha256 221: `aee79e9a48994ec0634fd8f1d6a0e8ec5742188baa06a1866f760e9815aba7f2`
- sha256 222: `ec7c2e908495a7351dabd68008028f844d305fd3dca944f654e392c9fac14ef0`
- `lib/releases/roll-call.ts`, `derived.ts`, `offers.ts`, `visibility.ts`
- `lib/ticket-warnings/next-rung.ts`, `lib/releases/ladder.ts`
- Frames: AB1b new. AB2, AB4 and AB5 reshot. AB1 and AB3 unchanged.

## Validation

- [x] `node --test` on `lib/releases/__tests__/bank.test.ts` and the caption price test
- [ ] `npm test` (CI)
- [ ] `npm run build` (CI)
- [ ] frames:check (CI)

## Notes

Neither migration is applied. 221 only adds the enum values; 222 writes them after that transaction has committed. Generated types do not name the migration file, so they were not regenerated. No rendered file changed, so no frame moved. H17 needs no build. The ticket-vendor reader stays paused.

Ubuntu pair, shot from `2587ad4`, threshold 0.1, every pair 0 pixels:

- https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/42691523498
- https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/42691537554
