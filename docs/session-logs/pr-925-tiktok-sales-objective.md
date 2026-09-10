# Session log

## PR

- **Number:** 925
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/925
- **Branch:** `cursor/tiktok-sales-objective`

## Summary

Sales is not a new `objective_type`. We already send `WEB_CONVERSIONS` for draft `CONVERSIONS`. This PR relabels that option **Sales**, adds `salesDestination` (default Website), and sends TikTok's two display fields (`virtual_objective_type: SALES`, `sales_destination`). Awareness is removed from the picker; existing Awareness drafts load with a blocker that names Reach. Engagement matches Ads Manager: Community interaction.

**Internal key stays `CONVERSIONS`.** Renaming the enum to `SALES` would rewrite a live write path (`OFFPIXEL_TIKTOK_WRITES_ENABLED` is on) and the `TIKTOK_OBJECTIVE_TYPE` mapping surface. The mapping to `WEB_CONVERSIONS` is untouched.

**Shipping Sales does not unblock the Ironworks draft.** `GET /api/tiktok/pixels?advertiser_id=7639802149165301776` returns `events: []`. Sales/Website still needs a fired `optimization_event`. For a See Tickets checkout the pixel will not fire `COMPLETE_PAYMENT` unless See Tickets sends it server-side. Sales is right for a client who owns their checkout; for Ironworks it is Traffic until that changes.

## Scope / files

- `lib/tiktok-wizard/campaign-setup.ts` — Sales label; Awareness off the picker; Community interaction
- `lib/types/tiktok-draft.ts` — `salesDestination` (`TIKTOK_SHOP` | `WEBSITE` | `APP`)
- `lib/tiktok/write/mapping.ts` — two Sales fields on `buildTikTokCampaignPayload` only
- `lib/tiktok-wizard/migrate-draft.ts` — old drafts get `WEBSITE`
- `components/tiktok-wizard/steps/campaign-setup.tsx` — destination select; Sales pixel warning; Awareness → Reach
- `lib/plan/tiktok-early.ts` — `tikTokSalesPixelNotFiredMessage`

Did not touch: the three drawers, `lib/tiktok/write/preflight.ts`, launch callers, adapters, schema, `OFFPIXEL_TIKTOK_WRITES_ENABLED`. No live launch.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5453 pass, 4 skipped)
- [x] `frames:check` — no frame file touched, no baselines regenerated. No frame renders the objective picker.

## Notes

See Tickets / Ironworks: Sales is the right objective only when the pixel can see a purchase. Until then, Traffic.
