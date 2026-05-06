# Session log — enhancement policy tuning

Copy template compliance: see `docs/SESSION_LOG_TEMPLATE.md`.

## PR

- **Number:** 316
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/316
- **Branch:** `creator/enhancement-policy-tuning`

## Summary

Tune Meta creative enhancement policy using PR #311 scan learnings: treat `inline_comment` as **TRACKED** (still persisted, excluded from severity, banner aggregates, and modal pills). Remove `image_brightness_and_contrast` from policy. Add `tracked_only` on `creative_enhancement_flags` so unresolved rows that only violate tracked features are filtered at read time without losing audit data.

## Scope / files

- `lib/meta/enhancement-policy.ts` — tiers, `getPolicyTier`, `isTrackedOnlyFlagSet`, evaluate blocked + tracked lists
- `supabase/migrations/085_creative_enhancement_flags_tracked_only.sql` — column, backfill, partial index
- `lib/db/database.types.ts` — `tracked_only` typings
- `app/api/internal/scan-enhancement-flags/route.ts` — set `tracked_only` on insert
- `lib/db/creative-enhancement-flags.ts` — default omit tracked-only rows; optional `includeTracked`; aggregates over blocked-visible set
- `app/api/clients/[clientId]/enhancement-flags/route.ts` — `includeTracked` query param
- `components/dashboard/EnhancementFlagBanner.tsx` — pills limited to BLOCKED tier
- `lib/meta/__tests__/enhancement-policy.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (scoped paths above)

## Notes

- After migration: `SELECT count(*) FROM creative_enhancement_flags WHERE tracked_only = true AND resolved_at IS NULL` should align with inline_comment–only unresolved ads from legacy scans.
- Re-scan rows pick up `tracked_only` from scanner + corrected blocked-only `severity_score`.
