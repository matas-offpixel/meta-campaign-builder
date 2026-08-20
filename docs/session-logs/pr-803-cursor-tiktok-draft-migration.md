# Session log

## PR

- **Number:** 803
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/803
- **Branch:** `cursor/tiktok-draft-migration`

## Summary

Drafts saved before #802 omit `identityBcId`, so client Review preflight blocked launch and the server hydrate that would have filled it never ran. Add `migrateTikTokDraft()` (Meta `migrateDraft` pattern) on load, resolve a missing BC id from the identities endpoint and persist it, and keep the preflight blocker only when the id genuinely cannot be resolved.

## Scope / files

- `lib/tiktok-wizard/migrate-draft.ts` — migrate + load-time identity BC resolve + client issue filter
- `lib/db/tiktok-drafts.ts` — apply migrate on row load
- Campaign page + wizard-shell heal; Review uses the client filter

## Validation

- [x] `npm run build`
- [x] `npm test` — 3973 = 3957 passed + 13 failed + 3 skipped (13 pre-existing)
- [x] eslint on changed files clean

## Notes

Did not change OFFPIXEL_TIKTOK_WRITES_ENABLED, paused create, rollback, `lib/autosave.ts`, or #801 diagnostic logging.
