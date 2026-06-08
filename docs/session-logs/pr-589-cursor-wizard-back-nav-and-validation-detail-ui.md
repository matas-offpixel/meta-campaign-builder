# Session log — bulk-attach validation errors + back navigation

## PR

- **Number:** 589
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/589
- **Branch:** `cursor/wizard-back-nav-and-validation-detail-ui`

## Summary

Edinburgh Dates Loading Bar launch surfaced generic "Creative validation failed" with no details, and broken back navigation after a failed Review step. Shows `details[]` from API, clickable step indicator back-nav, Launch gate when Page identity still loading.

## Scope

- `lib/bulk-attach/launch-validation.ts` — parse 400 details + readiness gate
- `components/bulk-attach/launch-error-panel.tsx` — error UI with bullets + back link
- `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx`
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx`

## Validation

- [x] `node --experimental-strip-types --test lib/bulk-attach/__tests__/launch-validation.test.ts`
- [ ] Edinburgh queue re-launch smoke
