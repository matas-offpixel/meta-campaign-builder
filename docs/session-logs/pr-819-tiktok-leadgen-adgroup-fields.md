# Session log

## PR

- **Number:** 819
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/819
- **Branch:** `cursor/tiktok-leadgen-adgroup-fields`

## Summary

Campaign create accepts `LEAD_GENERATION` but `/adgroup/create/` rejected the objective because `promotion_type` was still `WEBSITE` (the retired Conversions landing-page value). Website lead-gen now sends `promotion_type: LEAD_GENERATION` with `promotion_target_type: EXTERNAL_WEBSITE`. The pre-write log is the complete request body so the next rejection is diagnosable in one cycle.

## Scope / files

- `lib/tiktok/write/adgroup.ts` — one complete-payload `console.error` before `/adgroup/create/`
- `lib/tiktok/write/mapping.ts` — Lead generation promotion field set
- Tests: mapping full-object shape; complete-payload log; launch path

## Validation

- [x] `npm run build` (clean; existing Remotion `config` warning only)
- [x] `npx eslint` on changed files
- [x] `npm test` — 4105 = 4089 passed + 13 failed + 3 skipped (pre-existing 13; −1 vs #818 because two selective log tests became one complete-payload test)

## Notes

Field sources (not saved-audience models):

- `promotion_type` `LEAD_GENERATION` — Preview docs (portal `1739403070695426`): valid only when `objective_type` is `LEAD_GENERATION`. Instant Form create guide: set `promotion_type` to `LEAD_GENERATION`. Smart+ ad docs: same pairing with `promotion_target_type` `INSTANT_PAGE` or `EXTERNAL_WEBSITE`. SDK `AdgroupCreateBody.promotion_type` is optional unconstrained `str`.
- `promotion_target_type` `EXTERNAL_WEBSITE` — SDK ToolApi `tool_region`: `INSTANT_PAGE` | `EXTERNAL_WEBSITE` when `objective_type` is `LEAD_GENERATION`. Instant Form recipe uses `INSTANT_PAGE` (or omit); website therefore sends `EXTERNAL_WEBSITE`. Coexists with `promotion_type` `LEAD_GENERATION`.
- `optimization_goal` `CONVERT` — Instant Form official recipe uses `LEAD_GENERATION` (form submission, no pixel). Website + Ironworks Pixel / Complete registration is `CONVERT` (PR #517 IRWOHD rows). Ads Manager "Leads" is our `CONVERSION` → `CONVERT` label. `AdgroupCreateBody.optimization_goal` is required unconstrained `str`.
- `optimization_event` — required whenever `pixel_id` is set (ToolApi VBO note). Website lead-gen always sends the selected pixel event.
