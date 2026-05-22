# Cursor prompt [Cursor, Sonnet] — Google Search Wizard Phase 4: reporting integration verify

Copy this entire block into Cursor as a single message. Sonnet — this is mostly verification + a thin wiring fix if needed, not architectural.

PREREQUISITE: Phases 1-3 merged. At least one search campaign pushed (PAUSED) to a Google Ads account via the wizard, with an `[event_code]` prefix.

---

## GOAL

Verify that search campaigns created by the wizard flow into the EXISTING Google Ads reporting block (shipped 2026-04-30). The hypothesis from the scope doc is that this requires ZERO new reporting code — search campaigns with `[event_code]` in their name get picked up by the same matcher that handles the existing Google Ads (video/awareness) campaigns. This phase confirms that's true and fixes any gap.

Read first:
- `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md` (Phase 4 section)
- `lib/google-ads/insights.ts` — the GAQL query that fetches campaign insights. CRITICAL: check the `WHERE campaign.advertising_channel_type IN (SEARCH, VIDEO)` clause — if it already includes SEARCH, search campaigns are already covered. If it filters to VIDEO only somewhere, that's the gap.
- `lib/reporting/event-insights.ts` — the `fetchEventCampaignInsights` dispatch + `campaignNameMatchesEventCode` matcher
- `components/report/google-ads-report-block.tsx` — the share-page Google Ads render. Note: it currently assumes VIDEO campaigns (video quartiles, view-through rate, cost-per-view). Search campaigns have NONE of those — they have clicks, CTR, conversions, avg CPC instead.

## INVESTIGATE

1. Does `lib/google-ads/insights.ts` GAQL already select SEARCH campaigns? (It should — the awareness work used `IN (SEARCH, VIDEO)`.) Confirm.
2. When a SEARCH campaign is in the response, what do the video-specific metrics return? (`video_quartile_p25_rate` etc will be null/0 for search.) Does the report block handle null video metrics gracefully, or does it show broken "0 video views" tiles for a search campaign?
3. Does the Google Ads report block distinguish campaign type? It should show search-relevant metrics (clicks, CTR, avg CPC, conversions) for SEARCH campaigns and video-relevant metrics for VIDEO campaigns.

## LIKELY OUTCOME + FIX

**Most likely:** insights already fetch SEARCH campaigns (the GAQL includes it), but the report block renders them with video-shaped tiles that show zeros for video quartiles. The fix is a campaign-type-aware render in the Google Ads block:

- For VIDEO campaigns (existing): impressions, video views quartiles, VTR, cost-per-view, engagements
- For SEARCH campaigns (new): impressions, clicks, CTR, avg CPC, conversions (if tracking), cost-per-click

The `campaign_type` field is already on `CampaignInsightsRow` (the awareness work added it as `advertising_channel_type:sub_type`). Use it to branch the tile set per campaign in the breakdown table, and aggregate appropriately for the top-line tiles when an event has BOTH search and video campaigns.

If an event has mixed campaign types (e.g. a Junction 2 event running both a YouTube awareness campaign AND search campaigns), the Google Ads block should show both cleanly — either separate sub-sections (Video / Search) or a unified breakdown table with type-appropriate columns.

## SCOPE GUARD

This is verification + a thin render fix. If it turns out search campaigns ALREADY render fine (because the block handles nulls gracefully and shows clicks/CTR which search has), then the fix is near-zero — just confirm with a test and document. Do NOT over-build. The whole point of building reporting first (back in April) was that this phase is cheap.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-ads/ lib/reporting/ components/report/
node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Test:
- Insights query includes SEARCH campaigns (assert GAQL string)
- Report block renders a SEARCH campaign row with clicks/CTR/avgCPC, not broken video tiles
- Mixed event (search + video campaigns) renders both correctly

Manual (if a real pushed campaign exists): the share/report page for an event with a pushed search campaign shows it in the Google Ads block.

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-reporting-verify`
- Do NOT modify the awareness/video render path destructively — add SEARCH handling alongside, gate by campaign_type
- Do NOT add migrations
- Do NOT touch the mutate adapter or wizard
- Keep the diff minimal — this is a verify-and-patch, not a rebuild
- Regression-test: the existing BB26-KAYODE video Google Ads block must still render correctly (`/share/report/Rul8DeLZBVTZ0kZr`)

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-reporting-verify.md`. PR title: `feat(creator): Google Search reporting integration (Phase 4)`. Document whether new code was needed or it was already covered.

## DONE = the full arc closes

When this merges, the loop is complete: build plan (xlsx or manual) → review in wizard → push to Google Ads PAUSED → enable manually → campaign runs → reporting picks it up via [event_code] → shows in the same share report as Meta + TikTok + Google video. End-to-end Google Search campaign creation + reporting.
