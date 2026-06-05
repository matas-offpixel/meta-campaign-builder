# Session Log — cc/asset-queue-umbrella-events

**PR:** pending  
**Branch:** `cc/asset-queue-umbrella-events`  
**Date:** 2026-06-05  
**Model:** Claude Sonnet 4.6 (Cursor)

## Goal

Resolve "All" location rows in `client_asset_queue` to a `matched_umbrella` status that covers all venue mappings for a given nation (England, Scotland, or All). At launch, the bulk-attach flow pre-selects campaigns matching all relevant event codes via a `preselectCodes` URL param.

## Changes

### Database (migration 114)
- `ALTER TYPE asset_queue_status ADD VALUE 'matched_umbrella' IF NOT EXISTS`
- `ALTER TABLE client_asset_queue ADD COLUMN IF NOT EXISTS resolved_event_codes_multi text[]`

### `lib/clients/asset-queue/venue-resolve.ts`
- Added `UmbrellaResolution` interface (`isUmbrella: true`, `eventCodes: string[]`, `label: string`)
- Added `resolveVenueUmbrella(nation, mappings)` — returns all event codes for the nation
- Added `venueResolutionKey(location, nation)` — composite key `${location}::${nation}` for the resolution map
- Updated `buildVenueResolutionMap` to accept `{location, nation}[]` pairs; routes `location='All'` to umbrella path
- Existing `resolveVenue` signature preserved for backward compat (returns `ResolvedVenue | null`)

### `lib/db/asset-queue.ts`
- Added `'matched_umbrella'` to `AssetQueueStatus` union
- Added `resolved_event_codes_multi: string[] | null` to `AssetQueueRow` and `NewQueueRow`

### `app/api/clients/[id]/asset-queue/scrape/route.ts`
- Updated resolution to use composite `{location, nation}` pairs
- Umbrella rows: inserted with `status='matched_umbrella'`, `resolved_event_codes_multi=[...]`, `resolved_event_code=null`, `resolved_event_id=<first event's ID for URL routing>`
- `matched` count now includes umbrella rows

### `app/api/clients/[id]/asset-queue/[queueId]/prepare/route.ts`
- Accepts `matched_umbrella` status in addition to `matched`
- For umbrella rows: uses synthetic event name ("All England venues") in Anthropic prompt

### `components/dashboard/clients/asset-queue-panel.tsx`
- New `matched_umbrella` entry in `STATUS_LABEL`, `STATUS_COLOUR`, `STATUS_ORDER`
- Teal globe icon for umbrella rows
- Umbrella rows show "Will attach to N venues" in the subtitle
- `matched_umbrella` rows get a "Prepare" button (same as `matched`)
- `pending` umbrella rows get a "Review & Confirm" button → opens `UmbrellaReviewModal` (saves copy overrides + flips to `confirmed`)
- `confirmed` umbrella rows get an "Open Bulk Attach" button → navigates to `/events/{anchorId}/bulk-attach?preselectCodes=CODE1,CODE2,...`
- Skip button shown for `matched_umbrella` rows

### `components/bulk-attach/campaign-multi-picker.tsx`
- New optional props: `preselectCodes?: string[]`, `onPreselectLoad?: (campaigns: MetaCampaignSummary[]) => void`
- On first successful campaign load, fires `onPreselectLoad` with campaigns whose names contain any preselect code
- Shows teal callout when preselectCodes is active
- Uses `useRef` guard (not state) to avoid cascading renders

### `app/(dashboard)/events/[id]/bulk-attach/page.tsx`
- Reads `preselectCodes` from `searchParams`
- Adds `handlePreselectLoad` callback that batch-adds up to `BULK_ATTACH_CAP` campaigns
- Passes both props to `CampaignMultiPicker`

## Tests

### `lib/clients/asset-queue/__tests__/venue-resolve.test.ts`
- Full rewrite with umbrella-aware tests for `resolveVenue`, `resolveUmbrella`, `buildVenueResolutionMap`
- Covers nation filtering, case-insensitivity, deduplication, All+All cross-portfolio, composite keys

### `app/api/clients/[id]/asset-queue/scrape/__tests__/route.test.ts`
- New test: `matched_umbrella` row is inserted with `resolved_event_codes_multi` populated and `resolved_event_code=null`

## Non-Breaking Guarantees
- Existing statuses (matched/error/pending/confirmed/launched/skipped) untouched
- No table truncation
- Enum extended via `ADD VALUE IF NOT EXISTS` — safe for any Postgres version ≥ 9.1
- `preselectCodes` param is optional; bulk-attach page works normally without it
