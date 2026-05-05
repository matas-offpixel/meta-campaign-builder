## PR

- **Number:** `288`
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/288
- **Branch:** `creator/audience-creator-writes`

## Summary

Adds PR-B for Audience Creator: source pickers, funnel-stack flow, Meta write routes behind the feature flag, idempotency, sidebar promotion, and wizard selection for ready Off/Pixel audiences.

## Scope / files

- `app/audience-builder/**`, `app/audiences/**`, `app/api/audiences/**`
- `components/audiences/source-picker.tsx`, `components/steps/audiences/audiences-step.tsx`
- `lib/audiences/*`, `lib/meta/audience-*`, `lib/types/audience.ts`, `lib/types.ts`
- `components/dashboard/dashboard-nav.tsx`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npm run lint -- app/audience-builder app/audiences app/api/audiences components/audiences components/steps/audiences/audiences-step.tsx components/dashboard/dashboard-nav.tsx lib/audiences lib/meta/audience-write.ts lib/meta/audience-payload.ts lib/meta/audience-idempotency.ts lib/types/audience.ts lib/types.ts`
- [ ] `npm run lint` (known repo-wide lint debt outside this PR)

## Notes

`OFFPIXEL_META_AUDIENCE_WRITES_ENABLED` gates server-side writes. The local environment does not have the Vercel CLI installed, so the production env flip still needs to be applied from Vercel or CI.
