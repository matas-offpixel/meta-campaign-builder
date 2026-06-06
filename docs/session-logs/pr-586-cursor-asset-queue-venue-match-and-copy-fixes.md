# Session log — asset queue venue match + copy ground-truth

## PR

- **Number:** 586
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/586
- **Branch:** `cursor/asset-queue-venue-match-and-copy-fixes`

## Summary

Fixes production mis-match of "Colin Hendry Assets Glasgow" to WC26-EDINBURGH and Anthropic inventing venue/fixture details. Venue resolution now reads asset_name for venue/city tokens before falling back to sheet location. Copy prompts constrain Claude to ground-truth venue/city/event fields only.

## Scope / files

- `lib/clients/asset-queue/venue-resolve.ts` — three-tier asset_name matching + `eventMatchAmbiguous`
- `lib/clients/asset-queue/copy-generator.ts` — ground-truth system/user prompts; `venueName`/`venueCity` inputs
- `app/api/clients/[id]/asset-queue/scrape/route.ts` — load events venue metadata; asset-aware resolution map
- `app/api/clients/[id]/asset-queue/[queueId]/prepare/route.ts` — pass venue ground truth to copy generator
- `lib/db/asset-queue.ts` — `event_match_ambiguous` on row type
- `components/dashboard/clients/asset-queue-panel.tsx` — ambiguous match warning in table
- `supabase/migrations/117_asset_queue_event_match_ambiguous.sql`
- Tests: `venue-resolve.test.ts`, `copy-ground-truth.test.ts`

## Validation

- [x] `node --experimental-strip-types --test lib/clients/asset-queue/__tests__/venue-resolve.test.ts`
- [x] `node --experimental-strip-types --test lib/clients/asset-queue/__tests__/copy-ground-truth.test.ts`
- [ ] `npm run build`

## Notes

- When Glasgow asset_name matches two Glasgow venues, picks alphabetical event_code (O2 before SWG3) and sets `event_match_ambiguous=true`.
- Tier 3 sheet-label fallback unchanged when asset_name provides no city/venue signal.
