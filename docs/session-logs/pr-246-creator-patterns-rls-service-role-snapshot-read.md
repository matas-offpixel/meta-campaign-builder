## PR

- **Number:** 246
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/246
- **Branch:** `creator/patterns-rls-service-role-snapshot-read`

## Summary

Fixes the internal creative patterns page reading zero active-creative snapshots by using a service-role Supabase client only for the RLS-locked snapshot table, after the user-scoped event ownership query has produced the allowed event IDs.

## Scope / files

- `lib/reporting/creative-patterns-cross-event.ts`
  - Imports `createServiceRoleClient`.
  - Keeps `fetchClientEvents`, `fetchAssignments`, and `fetchRollups` on the cookie-bound user client.
  - Passes the service-role client only to `fetchLatestSnapshots`.
  - Logs `[creative-patterns] snapshot-fetch` with requested/returned counts and preset.

## Validation

- [x] `npm run lint -- lib/reporting/creative-patterns-cross-event.ts`
- [x] `npx tsc --noEmit`

## Notes

This preserves the ownership boundary by deriving `eventIds` through the user-scoped `events` query before bypassing RLS for `active_creatives_snapshots`.
