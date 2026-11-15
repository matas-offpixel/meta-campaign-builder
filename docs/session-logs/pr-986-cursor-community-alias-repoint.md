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

- [x] `node --test lib/wa-communities/__tests__/*.test.ts` — 35 passing
- [x] `eslint` on the alias files — no new errors
- [x] Down-migration of the slug constraint and `event_ref` ran inside a transaction and rolled back. Live `wa_community_aliases_slug_format` is still `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`. `event_ref` is absent. The new functions are absent.
- [ ] `npx tsc --noEmit` — this branch has no new errors in the alias files. The repo already fails `tsc` on unrelated tests.
- [ ] `npm run build` — not run
- [ ] Ops UI click-through — needs an operator session; not exercised in a browser

## Notes

Decision 1: destinations are authoritative. `rudimental-nx` disagrees today and was not repaired.

Decision 2: cirqlin `revalidate = 3600` is not changed in this PR.

On 27 Sep 2026 the down-migration was run inside a transaction and rolled back. Production now has migration 178: `supabase_migrations.schema_migrations` version `20260927120000`, name `178_wa_community_alias_repoint`. The file matches the live slug constraint, `event_ref`, `interstitial_enabled`, the column comments, both deferred triggers, and the bodies of `assert_wa_alias_invite_homes`, `trg_wa_alias_invite_homes_agree`, `create_community_alias`, and `repoint_community_alias`. That row stores no `statements` (`created_by` is null), so the check is the live objects. `service_role` can execute the trigger functions because the database's default privileges grant it, which the file's `revoke` list leaves in place.

15 Nov 2026: merged `main`. CLAUDE.md kept `CIRQLIN_TO_DASHBOARD_BEARER`. `package.json` keeps `@vercel/functions` at `^3.9.9` on top of main's dependencies.

Do not deploy on a day with a live D2C send. No `d2c_scheduled_sends` rows are scheduled between 27 Sep and 1 Oct 2026; Throwback Porto gen sale is still the kickoff gate (30 Sep).
