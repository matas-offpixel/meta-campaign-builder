# Session log

## PR

- **Number:** 383
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/383
- **Branch:** `creator/audience-followers-retention-zero`

## Summary

Align the audience builder with Meta's follower-audience retention constraint by documenting the forced `retention_seconds=0` payload behavior, adding regression coverage for FB/IG followers vs engagement audiences, and hiding the retention-day input in the UI for follower subtypes while explaining that these audiences are always live.

## Scope / files

- `lib/meta/audience-payload.ts`
- `lib/meta/__tests__/audience-write.test.ts`
- `components/audiences/source-picker.tsx`
- `app/(dashboard)/audiences/[clientId]/new/audience-create-form.tsx`
- `docs/session-logs/pr-383-creator-audience-followers-retention-zero.md`

## Validation

- [ ] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint lib/meta/audience-payload.ts lib/meta/__tests__/audience-write.test.ts components/audiences/source-picker.tsx "app/(dashboard)/audiences/[clientId]/new/audience-create-form.tsx"`

## Notes

The follower-retention payload logic was already present on `main`; this thread adds the requested no-op clarification comment plus the missing test and UI coverage around it.
