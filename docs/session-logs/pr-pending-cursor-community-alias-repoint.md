# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/community-alias-repoint`

## Summary

Mixed-case invite codes and dotted runbook slugs can be repointed from `wa_community_alias_destinations`, which is the authoritative invite code. `active_invite_code` stays a cache written in the same transaction. The public `/j` lookup stays fail-open for both slug-shaped and invite-shaped segments. Cirqlin's interstitial is unchanged until Decision 2 is picked.

## Scope / files

- `supabase/migrations/178_wa_community_alias_repoint.sql` — verified constraint swap, `event_ref`, repoint/create functions, deferred homes guard
- `app/j/[invite]/route.ts` and `lib/wa-communities/*` — fail-open lookup, runtime cache, read API
- `app/api/community-aliases/[slug]/route.ts` — bearer read for cirqlin
- `docs/community-aliases.md` — runbook
- `scripts/backfill-community-aliases.mjs` — dry run only

## Validation

- [x] `node --test lib/wa-communities/__tests__/*.test.ts` — 35 passing
- [x] `eslint` on the alias files — no new errors
- [x] Down-migration of the slug constraint and `event_ref` ran inside a transaction and rolled back. Live `wa_community_aliases_slug_format` is still `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`. `event_ref` is absent. The new functions are absent.
- [ ] `npx tsc --noEmit` — this branch has no new errors in the alias files. The repo already fails `tsc` on unrelated tests.
- [ ] `npm run build` — not run
- [ ] Ops UI click-through — needs an operator session; not exercised in a browser

## Notes

Decision 1: destinations are authoritative. `rudimental-nx` disagrees today and was not repaired.

Decision 2: cirqlin `revalidate = 3600` is not changed in this PR.

Migration 178 was not applied to production. The down-migration was run inside a transaction and rolled back.

Do not deploy on a day with a live D2C send. No `d2c_scheduled_sends` rows are scheduled between 27 Sep and 1 Oct 2026; Throwback Porto gen sale is still the kickoff gate (30 Sep).
