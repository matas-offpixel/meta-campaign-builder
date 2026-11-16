# Session log

## PR

- **Number:** 986
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/986
- **Branch:** `cursor/community-alias-repoint`

## Summary

Mixed-case invite codes and dotted runbook slugs can be repointed from `wa_community_alias_destinations`, which is the authoritative invite code. `active_invite_code` stays a cache written in the same transaction. The public `/j` lookup stays fail-open for both slug-shaped and invite-shaped segments.

Follow-up: migration 178 also adds `wa_community_aliases.interstitial_enabled boolean not null default false`, and `GET /api/community-aliases/:slug` returns it next to the invite code. Cirqlin #454 renders the card only when the field is true. Default false means every alias 302s until someone turns the card on.

## Scope / files

- `supabase/migrations/178_wa_community_alias_repoint.sql` — verified constraint swap, `event_ref`, repoint/create functions, deferred homes guard
- `app/j/[invite]/route.ts` and `lib/wa-communities/*` — fail-open lookup, runtime cache, read API
- `app/api/community-aliases/[slug]/route.ts` — bearer read for cirqlin
- `docs/community-aliases.md` — runbook
- `scripts/backfill-community-aliases.mjs` — dry run only

## Validation

- [x] `node --test lib/wa-communities/__tests__/*.test.ts` — 41 passing (16 Nov)
- [x] `npm test` — 9440 node tests + 124 vitest, 0 failures (16 Nov)
- [x] `npm run build` — compiled, typecheck finished, `/api/community-aliases/[slug]` is dynamic (16 Nov)
- [x] `eslint` on the alias files — clean. Repo-wide `npm run lint` still reports existing errors outside this change; CI does not run lint.
- [x] Live slug check, 16 Nov: 20/20 slugs match the migration 178 shape. 19 active aliases resolve to their active code. `rudimental-nx` does not.
- [ ] Ops UI click-through — needs an operator session; not exercised in a browser

## Notes

16 Nov 2026: merged `main` (clean; `CLAUDE.md` already carried `CIRQLIN_TO_DASHBOARD_BEARER`). Re-checked migration 178 against production. `schema_migrations.statements` for `20260927120000` is NULL (`created_by` null, same shape as 175 and 176), so there is no stored statement text to diff. The file was not edited. Live objects match it: slug check `^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$`, `event_ref`, `interstitial_enabled` default false, the four column comments, both deferred triggers, and the bodies of `assert_wa_alias_invite_homes`, `trg_wa_alias_invite_homes_agree`, `create_community_alias`, and `repoint_community_alias`. Do not re-apply.

Same day, 20 alias rows. All 20 slugs match the new shape. 19 active rows resolve to `active_invite_code`. Five of those have no destination row (`ewanmcvicar-nx`, `glitterbox-bristol`, `kream-bristol`, `locklead-nx`, `lprhythm-sheffield`); the read uses the cache only when no active destination exists. A destination still wins when one is present. `rudimental-nx` stays inactive and does not resolve. Named codes: locklead-nx `C7WMSoEAPJL59FIY0iDJd2`, kream-bristol `DLsK34iUMpC3sFDg80CQrd`, ewanmcvicar-nx `Dl7VK7opleoKWbemaQFcW8`, paulvandyk-nx `FcmnE27aoR649oO9QSz4MR`.

`GET /api/community-aliases/{slug}` compares `CIRQLIN_TO_DASHBOARD_BEARER` with `timingSafeEqual`. Unset returns 401 and returns no invite code. The value is not logged.

Decision 1: destinations are authoritative when a destination row exists. `rudimental-nx` disagrees today and was not repaired. The five cache-only rows were not given destination rows in this change.

Decision 2: cirqlin `revalidate = 3600` is not changed in this PR.

On 27 Sep 2026 the down-migration was run inside a transaction and rolled back. Production now has migration 178: `supabase_migrations.schema_migrations` version `20260927120000`, name `178_wa_community_alias_repoint`. The file matches the live slug constraint, `event_ref`, `interstitial_enabled`, the column comments, both deferred triggers, and the bodies of `assert_wa_alias_invite_homes`, `trg_wa_alias_invite_homes_agree`, `create_community_alias`, and `repoint_community_alias`. That row stores no `statements` (`created_by` is null), so the check is the live objects. `service_role` can execute the trigger functions because the database's default privileges grant it, which the file's `revoke` list leaves in place.

15 Nov 2026: merged `main`. CLAUDE.md kept `CIRQLIN_TO_DASHBOARD_BEARER`. `package.json` keeps `@vercel/functions` at `^3.9.9` on top of main's dependencies.

Do not deploy on a day with a live D2C send. No `d2c_scheduled_sends` rows are scheduled between 27 Sep and 1 Oct 2026; Throwback Porto gen sale is still the kickoff gate (30 Sep).
