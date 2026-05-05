# Session log

## PR

- **Number:** 281
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/281
- **Branch:** `fix/additional-ticket-entries-running-total`

## Summary

Changed additional ticket entries from additive submissions to running-total snapshots keyed by event, scope, tier, source, and label.

## Scope / files

- `supabase/migrations/075_additional_ticket_entries_running_total_key.sql`
- `lib/db/additional-tickets.ts`
- `app/api/events/[id]/additional-tickets/route.ts`
- `components/dashboard/events/additional-ticket-entries-card.tsx`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint <changed files>`
- [ ] `npm run lint` (fails on pre-existing repo-wide lint errors outside this change: `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, existing hook/effect warnings, etc.)

## Notes

The Supabase MCP migration tool is not available in this Cursor session, so migration application and production duplicate verification still need to be run from an environment with Supabase project access.
