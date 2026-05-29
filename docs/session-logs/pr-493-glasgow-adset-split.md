# Session log — Glasgow ad-set-aware spend/engagement split

## PR

- **Number:** 493
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/493
- **Branch:** `cursor/glasgow-adset-split`

## Summary

Adds ad-set-level attribution split for Meta campaign 6925933901665
(`[WC26-GLASGOW-O2] TRAFFIC`), which contains 5 O2-tagged and 4 SWG3-tagged
ad sets but is bracketed to WC26-GLASGOW-O2. The entire campaign's spend,
reach, clicks, and LPV were incorrectly attributed 100% to WC26-GLASGOW-O2.
The fix applies a 74.54/25.46 split (verified via Meta MCP 2026-05-29) across
both the lifetime cache (engagement) and the rollup-backed spend, on both the
Funnel Pacing and Performance Summary surfaces.

## Scope / files

| File | Change |
|------|--------|
| `lib/dashboard/event-code-adset-splits.ts` | NEW: `CAMPAIGN_SPLITS` config + `applyAdsetSplitsToLifetimeMeta()` + `getSpendAdjustmentGbp()` |
| `lib/db/client-portal-server.ts` | Apply `applyAdsetSplitsToLifetimeMeta` to `lifetimeMetaByEventCode` after loading (covers all lifetime-cache consumers) |
| `lib/dashboard/venue-canonical-funnel.ts` | Add `spendAdjustmentGbp` input param; apply to `spend` and seed `computeSpendReconciliation`'s `spent` |
| `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` | Pass `spendAdjustmentGbp: getSpendAdjustmentGbp(eventCode)` to `buildVenueCanonicalFunnel` |
| `app/share/venue/[token]/page.tsx` | Same for the share venue surface |
| `components/share/client-portal-venue-table.tsx` | Apply `getSpendAdjustmentGbp` to `venueDisplaySpend` in `VenueSection` before passing to `aggregateVenueCampaignPerformance` |
| `lib/dashboard/__tests__/event-code-adset-splits.test.ts` | NEW: 16 unit tests |

## Data path

- Chosen path: **hardcoded campaign snapshot** (spend £6,562.92, reach 915,207,
  clicks 84,725, LPV 52,839). Live Meta MCP was not reachable at implementation
  time. Snapshot refresh needed quarterly or when campaign 6925933901665 ends.
- The split ratio (74.54% O2 / 25.46% SWG3) is derived from ad-set-level
  lifetime spend as of 2026-05-29.

## Validation

- `npx tsc --noEmit`: 0 new production-file errors
- `node --test lib/dashboard/__tests__/event-code-adset-splits.test.ts`: 16/16 pass
- No lint errors (`ReadLints`)

## Notes

- Non-Glasgow venues: zero-cost (helpers return 0 / pass-through immediately)
- Glasgow combined (O2 + SWG3) spend total is conserved
- `impressions` and `engagements` are NOT split (reach is the audience proxy; 
  impressions follow reach proportionally)
