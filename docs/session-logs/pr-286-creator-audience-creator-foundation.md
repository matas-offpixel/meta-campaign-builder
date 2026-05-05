## PR

- **Number:** `286`
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/286
- **Branch:** `creator/audience-creator-foundation`

## Summary

Adds PR-A foundation for the Meta Audience Creator: draft persistence schema, typed presets, server helpers, authenticated API routes, list and create screens, and a minimal wizard link-out.

## Scope / files

- `supabase/migrations/069_meta_custom_audiences.sql`
- `lib/types/audience.ts`, `lib/audiences/*`, `lib/db/meta-custom-audiences.ts`
- `app/audiences/[clientId]/**`, `app/api/audiences/**`
- `components/steps/audiences/audiences-step.tsx`
- Audience preset and create-payload tests

## Validation

- [x] `npm run lint -- lib/audiences lib/types/audience.ts lib/db/meta-custom-audiences.ts app/audiences app/api/audiences components/steps/audiences/audiences-step.tsx components/wizard/wizard-shell.tsx`
- [x] `npm run build`
- [x] `npm test`
- [ ] `npm run lint` (blocked by pre-existing repo-wide lint errors outside this PR)

## Notes

PR-A intentionally makes no live Meta write API calls. PR-B will add the write path behind `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED`; PR-C can deepen the wizard integration once writes are proven.
