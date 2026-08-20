# Session log — TikTok campaign launch path

## PR

- **Number:** 787
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/787
- **Branch:** `cursor/tiktok-launch-writes`

## Summary

Wires the existing TikTok write orchestrator end-to-end: Review & Launch can
POST `/api/tiktok/launch-campaign` after an all-at-once preflight. Ad payloads
force `is_aco: false` and `creative_authorized: false`. Ad-group payloads now
map draft targeting and optimisation onto official v1.3 field names. Smart+
blocks the launch. Safety follow-up: campaign/ad group/ad all created paused;
idempotency ledger cleared on rollback; per-ad-group budget floor (lifetime =
20 × scheduled days); Creative Integrity is a fixed statement; WEB_CONVERSIONS
requires a pixel + pixel-sourced `optimization_event`. The Vercel flag stays
unset so the first live write can be a paused smoke-test.

## Scope / files

- `lib/tiktok/write/mapping.ts` — official v1.3 enum/field mappings
- `lib/tiktok/write/preflight.ts` — all-at-once launch blockers
- `lib/tiktok/write/{ad,adgroup,campaign,orchestrator,launch,error-classify}.ts`
- `app/api/tiktok/launch-campaign/route.ts`
- `components/tiktok-wizard/steps/review-launch.tsx`
- `lib/types/tiktok-draft.ts` — Creative Integrity Mode + published IDs
- Tests under `lib/tiktok/__tests__/`
- `CLAUDE.md` TikTok launcher + `OFFPIXEL_TIKTOK_WRITES_ENABLED`

## Validation

- [x] TikTok launch/mapping/preflight/route/pixel/advertiser tests (46 passing)
- [x] `npx tsc --noEmit` — no new errors in TikTok launch files
- [ ] `npm run build` (when applicable)

## Notes

- `OFFPIXEL_TIKTOK_WRITES_ENABLED` must stay unset in Vercel until a paused
  smoke-test campaign has been verified.
- Campaign, ad groups, and ads are created with `operation_status: DISABLE`.
- `tiktok_write_idempotency` is service-role-only, so the route uses
  `createServiceRoleClient()` for write-ledger rows after session auth +
  ownership have already been checked. Rollback deletes those rows so a
  retry cannot short-circuit onto a deleted campaign_id.
- Lifetime floor is 20 × scheduled days, not a flat 20. Non-GBP advertiser
  currency is a warning, not a silent GBP apply.
- Geo targeting is still country-level only (later PR).
