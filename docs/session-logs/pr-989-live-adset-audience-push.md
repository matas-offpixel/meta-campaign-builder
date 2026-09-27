# Session log

## PR

- **Number:** 989
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/989
- **Branch:** `cursor/live-adset-audience-push`

## Summary

Published campaigns can add or remove one custom audience on live ad sets. The write reads the whole targeting object, changes only `custom_audiences` or `excluded_custom_audiences`, and posts that object back. It is gated by `OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED === "true"` and recorded as `adset_targeting_update` on the Meta write ledger. Migration 179 adds that op kind to the check constraint. Matas applies it. 178 belongs to the community-alias repoint.

## Scope / files

- `lib/meta/adset-targeting-write.ts` — read-merge-write
- `components/library/adset-audience-push.tsx` — Published tab control
- `app/api/meta/adset-audience/route.ts` — preview and apply
- `supabase/migrations/179_meta_write_idempotency_adset_targeting.sql`
- `CLAUDE.md` — the new gate

## Validation

- [x] `npm test` — 6354 tests, 6350 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled, TypeScript finished
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

No `META_ACCESS_TOKEN` in this environment, and the new gate is unset. The paused smoke test was not run. There is no before/after targeting read from Meta to paste. The two test pixel audiences were not created.

A successful add deletes the matching remove ledger row, and a successful remove deletes the matching add row, using the same delete-by-hash invalidation as `invalidateDeadCampaignLedger`. A retry of one step still does not POST.

A new id is not written through the launch route. Optimisation's budget and pause writes are untouched.
