# Session log — creator/enhancement-spec-probe

## PR

- **Number:** 307
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/307
- **Branch:** `creator/enhancement-spec-probe`

## Summary

Adds a read-only admin GET route that samples ACTIVE ads for a client’s Meta ad account and aggregates `degrees_of_freedom_spec.creative_features_spec` feature keys and `enroll_status` values from production Graph responses, plus serial ad-level `multi_advertiser_ads_options` observations. Intended to confirm Marketing API field names before building the enhancement detector; no persistence.

## Scope / files

- `app/api/admin/meta-enhancement-probe/route.ts` — probe handler (CRON_SECRET or session + ownership).
- `lib/auth/public-routes.ts` — allow unauthenticated middleware pass-through so Bearer cron curls hit the route (auth enforced in handler).
- `docs/probes/META_ENHANCEMENT_PROBE.md` — usage and removal note.

## Validation

- [x] `npx eslint app/api/admin/meta-enhancement-probe/route.ts lib/auth/public-routes.ts`
- [x] `npm run build`
- [ ] Local curl with `CRON_SECRET` and real `clientId` returns 200 and non-empty `distinct_features` when creatives expose DOF spec (if empty with `sampled_ads > 0`, verify `degrees_of_freedom_spec` in Graph `fields`).

## Notes

Transient tooling — delete route + public-route exception + probe doc after enhancement-detector ships.
