# Session log

## PR

- **Number:** 1144
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1144
- **Branch:** `cursor/asset-bank-m6b`

## Summary

Asset bank issue 3 (H12–H16). The roll-call is a `roll_call` rung whose two lines come from the event's releases, and it is proposed ahead of a % rung for the same release. Four derived rungs sit under it. An offer is entered on its own sheet and table, never on the ladder. A cancelled event keeps its rows and mounts nothing. A backfilled row stays plain until the first tap.

## Scope / files

- `supabase/migrations/221_asset_bank_m6b.sql` — enum values, ladder rows, `event_offers`. Not applied.
- sha256: `90d78a694d9c92be41ac07c563a7eeb454ea6f1f7e73194fb54ee7549991a79b`
- `lib/releases/roll-call.ts`, `derived.ts`, `offers.ts`, `visibility.ts`
- `lib/ticket-warnings/next-rung.ts`, `lib/releases/ladder.ts`
- Frames: AB1b new. AB2, AB4 and AB5 reshot. AB1 and AB3 unchanged.

## Validation

- [x] `node --test` on `lib/releases/__tests__/bank.test.ts` and the caption price test
- [ ] `npm test` (CI)
- [ ] `npm run build` (CI)
- [ ] frames:check (CI)

## Notes

Migration 221 is not applied. H17 needs no build. The ticket-vendor reader stays paused.

Ubuntu pair, shot from `2587ad4`, threshold 0.1, every pair 0 pixels:

- https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/42691523498
- https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/42691537554
