# PR #526 — fix(share-report): Spark Ad cards clickable + TikTok demographics layout parity with Meta

**Branch:** `cursor/spark-clickable-and-tiktok-layout-parity`
**PR:** pending
**Date:** 2026-06-03

## Fix 1 — Spark Ad cards not clickable

### Problem
Push-content TikTok ad cards link to a landing page (clickable). Spark Ad cards (VID 1/2/3,
long-copy Spark Ads) have `previewUrl = null` and `landingPageUrl = null` because Spark Ads
reference an existing organic post rather than a dedicated landing page. Both `deeplink_url`
and `post_url` end up `null` → cards are unclickable.

### Fix
Fall back to `https://www.tiktok.com/video/{tiktok_item_id}` when both `previewUrl` and
`landingPageUrl` are null but `tiktokItemId` is present.

- **`lib/tiktok/share-render.ts`** — updated `post_url` and `deeplink_url` in
  `fetchTikTokAdsForShareUncached` return mapping.
- **`lib/tiktok/snapshots.ts`** — updated `rowToAd` so existing snapshot rows get the
  fallback URL without needing a re-fetch.

## Fix 2 — TikTok demographics layout parity with Meta

### Problem
On the TikTok pill: Active Creatives appeared before the demographics breakdowns (wrong order),
the breakdowns were flat headers (no accordion), labels said "Demographics by Age/Gender" (not
"Demographics — Age/Gender"), the column set was missing REACH, and the first column read
Country/Age/Gender instead of "Segment".

### Fix

**A. Section order** — `TikTokAudienceSection` (demographics) now renders before Active
Creatives, matching Meta's order: stats → breakdown table → demographics → creatives.

**B. Collapsible accordions** — removed `TikTokBreakdownSubSection` (flat header). Now uses
`BreakdownSection` (exported from `meta-insights-sections.tsx`) — same chevron accordion Meta
uses.

**C. Header labels** — "Demographics — Age" / "Demographics — Gender" (em-dash, matches Meta).

**D. REACH column** — added `reach` to `TikTokSnapshotBreakdown` interface, updated the DB
`SELECT` in `app/share/report/[token]/page.tsx` to include `reach`, and added the Reach column
to all three breakdown tables. Column order: Segment | Spend | Impr. | Reach | Clicks | CTR.

**E. Column header** — first column reads "Segment" for all three tables (matches Meta's
`DemographicTable`).

## Files changed

| File | Change |
|------|--------|
| `lib/tiktok/share-render.ts` | Spark Ad URL fallback in return mapping |
| `lib/tiktok/snapshots.ts` | Spark Ad URL fallback in `rowToAd` |
| `components/report/event-report-view.tsx` | Section reorder + accordions + reach + labels |
| `components/report/meta-insights-sections.tsx` | Export `BreakdownSection` |
| `app/share/report/[token]/page.tsx` | Add `reach` to breakdown SELECT |
| `components/report/__tests__/tiktok-snapshot-helpers.test.ts` | Add `reach: null` to test fixture |

## Tests

```
25/25 pass
```
