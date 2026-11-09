# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/asset-bank-m6b`

## Summary

Asset bank issue 3 (H12–H16). The roll-call is a `roll_call` rung whose two lines come from the event's releases, and it is proposed ahead of a % rung for the same release. Four derived rungs sit under it. An offer is entered on its own sheet and table, never on the ladder. A cancelled event keeps its rows and mounts nothing. A backfilled row stays plain until the first tap.

## Scope / files

- `supabase/migrations/221_asset_bank_m6b.sql` — enum values, ladder rows, `event_offers`. Not applied.
- `lib/releases/roll-call.ts`, `derived.ts`, `offers.ts`, `visibility.ts`
- `lib/ticket-warnings/next-rung.ts`, `lib/releases/ladder.ts`
- Asset bank frames AB1b, AB2, AB5, and the offer row on the board

## Validation

- [x] `node --test` on `lib/releases/__tests__/bank.test.ts` and the caption price test
- [ ] `npm test`
- [ ] `npm run build`
- [ ] frames:check

## Notes

Migration 221 is not applied. H17 needs no build. The ticket-vendor reader stays paused.
