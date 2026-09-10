# Session log

## PR

- **Number:** 930
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/930
- **Branch:** `cursor/initiate-checkout-objective`

## Summary

Meta hardcodes the objective bundle; TikTok reads the platform. This PR adds `initiate_checkout` as a sixth Meta wizard bundle (`OUTCOME_SALES` + `custom_event_type: INITIATED_CHECKOUT`) for clients whose checkout lives on someone else's domain. The pixel event still has to fire on the landing page — wiring the objective does not instrument `evntr.ee`. TikTok needs no code: InitiateCheckout is a pixel optimisation event under Sales, and the picker already lists whatever Events Manager reports.

## Scope / files

- `lib/types.ts` — `CampaignObjective` gains `initiate_checkout`
- `lib/meta/campaign.ts` — `OBJECTIVE_MAP`, `buildCampaignPayload`, reverse map with explicit `OUTCOME_SALES` default
- `lib/meta/adset.ts` — `eventTypeMap` + purchase-shaped goals
- `lib/meta/client.ts` — campaign create uses `buildCampaignPayload`
- Wizard tile + preset labels + optimisation ladder (CPA, no ROAS) + live-metric checkout action types
- Tests: byte-identical payloads for the five existing objectives; reverse-map decision; TikTok deny-list does not block InitiateCheckout

Did not touch: the three drawers, `components/plan/**`, `lib/tiktok/write/**`, plan objective intents (stay the five canvas units), `ENABLE_PLAN_FANOUT` / `OFFPIXEL_TIKTOK_WRITES_ENABLED` / `ENABLE_OPTIMISATION_WRITES`. No launch. No frames.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5477 pass, 4 skipped)

## Notes

Meta's documented pixel table says `INITIATE_CHECKOUT`. The Marketing API enum is `INITIATED_CHECKOUT`. Probe on 2026-09-10: `INITIATE_CHECKOUT` is rejected (code 100, enum list includes `INITIATED_CHECKOUT`); `INITIATED_CHECKOUT` is accepted. Meta ignored `validate_only=true` on this account; both paused probe ad sets were deleted. Use what Meta returns.

`OUTCOME_SALES` without a `custom_event_type` defaults to `purchase`. Campaign listings do not carry `promoted_object` (that field lives on ad sets). Do not walk `OBJECTIVE_MAP` — two internals share one Meta objective.

TikTok's shape is the better one. Meta's is the one we keep paying for.
