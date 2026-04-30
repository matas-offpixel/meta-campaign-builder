## PR

- **Number:** `224`
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/224
- **Branch:** `ops/migration-collision-rename`

## Summary

Cosmetic migration filename cleanup to remove duplicate local integer prefixes after the Google Ads, Meta awareness, and snapshot migrations landed on `main`. Supabase remote migration tracking was verified before renaming.

## Scope / files

- `supabase/migrations/*` filename-only renames across the 060-range migration sequence.
- Docs and session-log references to renamed migration files.

## Validation

- [x] `npx supabase migration list --linked`
- [x] `npx supabase db query "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 12;" --linked`
- [x] highest local migration filename is unique after rename
- [x] no duplicate local migration integer prefixes remain
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] `npm test` (not run; not applicable for filename-only cleanup)

## Migrations / infra state

Filenames-only change, no DB action required, all renamed migrations already applied in prod. Supabase tracks applied migrations by `supabase_migrations.schema_migrations.version`; the remote `name` field stores the migration name separately and does not make these local filename-prefix renames re-apply the SQL.

## Notes

The original request targeted `063` and `064`, but current `origin/main` already had additional `063`/`064` migration files. This PR keeps the requested Google Ads ordering at `063`/`064` and moves later landed migrations to `065`/`066`/`067` so the whole local sequence is collision-free.
