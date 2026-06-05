# Session log — bulk-attach-drafts

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/bulk-attach-drafts`

## Summary

Adds draft-save functionality to the bulk-attach flow (`/events/[id]/bulk-attach`).
Operators can save mid-session state (campaign selection, ad-set selection, configured
creatives) to Supabase and resume from any browser without re-doing the campaign picker.
Drafts are user-scoped via RLS. A localStorage autosave provides session-local convenience
without touching the server.

## Scope / files

- `supabase/migrations/113_bulk_attach_drafts.sql` — new table with RLS + index
- `lib/bulk-attach/draft-state.ts` — serialisation / deserialisation helpers (Maps → JSON-safe arrays)
- `lib/db/bulk-attach-drafts.ts` — server-side CRUD (list, get, save/upsert, delete, touch)
- `app/api/bulk-attach-drafts/route.ts` — GET (list) + POST (save/update)
- `app/api/bulk-attach-drafts/[id]/route.ts` — GET (single) + DELETE
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` — Save draft button + name input, Resume drafts modal, localStorage autosave, unsaved-changes banner
- `app/api/bulk-attach-drafts/__tests__/route.test.ts` — 17 pure-logic tests

## Validation

- [x] `npx tsc --noEmit` — 0 new errors (pre-existing errors in unrelated test file unchanged)
- [x] `node --experimental-strip-types --test` — 17/17 pass
- [ ] Migration 113 applied to Supabase (prerequisite before merge)
- [ ] Manual RLS isolation test: user A cannot read user B's draft

## Notes

- `client_id` is nullable in v1; populated via event lookup in a future iteration if needed.
- localStorage autosave key: `bulk-attach-unsaved-{eventId}`. Cleared on explicit Save and on reset.
- Draft auto-save to Supabase is intentionally **not** wired in — only on explicit Save button click.
- Drafts do not auto-launch — they are state snapshots only.
