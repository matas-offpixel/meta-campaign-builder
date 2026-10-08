# Session log: Google video plans → Google Ads Editor CSV

## PR

- **Number:** 1038
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1038
- **Branch:** `cursor/google-video-editor-export`

## Summary

PR 3 of the Google launcher v2 arc. The Google Ads API cannot create or change Video campaigns, so a YouTube video build sheet is now imported, checked, and downloaded as a Google Ads Editor CSV. Nothing is sent to Google. Matas imports the file in Editor 2.13.4 and posts from there. The same import route also gets three detection fixes. An unrecognised sheet gets a 422 listing the tabs found and the tabs expected. "Parsed 0 campaigns" names the tabs read. An empty Keywords tab no longer outranks video signals.

## Scope / files

- `supabase/migrations/190_google_video_plans.sql`: plans / campaigns / ad_groups / placements / ads, owner-only RLS like 096, status draft/exported/live, `exported_at`, no push columns, `device_exclusions` default `{CONNECTED_TV}`. Unapplied.
- `supabase/migrations/191_google_video_responsive_ads.sql`: `business_name`, `extra_copy`. Unapplied.
- `lib/google-video/locations.ts`: location IDs checked against Google's geotargets CSV.
- `lib/google-search/workbook.ts`: detection with keyword-row counts and the Campaign Settings video signal; unknown and empty-Search messages; shared `cell` / `numericOrNull` / `rawRows` / `recordsFromRawRowsWithHeaderScan` (moved from `xlsx-import.ts`). `header-key.ts` holds `headerKey` / `sheetTokens` without xlsx so client code can use them. `workbook-kind-labels.ts` is for the import panel.
- `lib/google-video/`: `types.ts`, `youtube-url.ts`, `xlsx-import.ts`, `validation.ts` (blockers, warnings, the list of settings to set in Editor), `editor-export.ts` (pure, golden-tested).
- `lib/db/google-video-plans.ts`: create, load, list, save in place, status.
- `app/api/google-search/import/route.ts`: video goes to the video importer; unknown → 422; empty Search → tabs appended.
- `app/api/google-video/[id]` (PUT save, PATCH draft/live) and `[id]/export` (POST → CSV, sets exported).
- `app/google-video/[id]/page.tsx` + `components/google-video/plan-editor.tsx`: Settings → Targeting → Placements → Ads → Review.
- `components/google-search/plan-actions.tsx`: shows the detected plan type and opens `/google-video/[id]` for a video sheet. The Search wizard and `/google-search` are untouched.
- `app/(dashboard)/google-ads/page.tsx`: lists video plans. Empty until 190 is applied.
- `CLAUDE.md`: route, "Google video plans" note, latest migration.

## Validation

- [x] `npx tsc --noEmit`: no new errors vs main
- [ ] `npm run build`: Turbopack rejects the worktree's symlinked `node_modules`; CI builds it
- [x] `npm test`: 7129 node tests + 8 vitest, 0 failures (round 2)
- [x] eslint on changed files: clean

## Notes

- Merge gate: Matas imports `lib/google-video/__tests__/fixtures/IRW0004_CamelPhat_YouTubeVideo.editor.csv` in Editor without posting. It must show zero errors.
- On the CamelPhat sheet, the ads' Video cells hold titles, not links. The golden file links Ad 2 to `ozh-w-EBw58`, which the sheet's Summary names as the full recap. Ad 1's 15s cut isn't uploaded yet (checklist item 1), so the file leaves it out. In the app, Review blocks download until both enabled ads have a link.
- Editor's CSV pages don't document the values for Bid Strategy Type, Ad Group Type, bid-modifier formats or YouTube placement URLs. Those are the import's real test.
- Review round 1: PATCH loads the plan first (404 like PUT); the export route catches a failed status update (500); import warns when ad copy contains ";" (Editor value separator). Migration 190 applied to prod 2026-10-08.
- Editor test 1 (Matas): 0 errors, 8 warnings. Editor deprecates Manual CPV (Convert → Target CPV, "Responsive video" ad groups, "Responsive video ad" ads); our "In-stream" ad group type fell back to non-skippable. Budget defaulted to "Campaign total" (£8.80 for the whole run). "EU political ads" is required. The TV Screen Bid Modifier and location bid values were rejected.
- Round 2 (this commit) rebuilds the file from Matas's 0-error Editor export, `__tests__/fixtures/editor-template-export.tsv` (bytes kept; UTF-16LE TSV, 111 columns):
  - Target CPV everywhere; responsive video ads with `Video ID 1` and copy slots 1..5; `Business name` (blocker if empty).
  - Budget type: a plan total is `Campaign total`; otherwise the daily budget is `Daily`. "Daily" is the one unproven value: the template only shows "Campaign total", and Google's CSV page lists no values.
  - EU political ads always "Doesn't have EU political ads". Placements in `Website` without a scheme. Ad formats and Inventory type are left unset.
  - No TV or location bid modifiers. Review's manual list has Include Google TV: Disabled, each location adjustment, the frequency cap and the logo.
  - Migration 191: `google_video_plans.business_name`, `google_video_ads.extra_copy`. Unapplied. **PR 4a moves to 192.**
- Location IDs: 9049069 is Estepona, Spain in Google's geotargets CSV (2026-08-12), not South East England. Google has no English region targets. The video export now uses its own checked table (`lib/google-video/locations.ts`). `GEO_TARGET_CONSTANTS_MAP` in `lib/google-ads/geo-resolve.ts` (the Search push fallback) is wrong for most entries (Manchester → Billingshurst, Birmingham → Birkenhead, Wales/Scotland/Northern Ireland IDs off). Not changed here: Search is out of scope.
- Merge gate, test 2: Matas imports the regenerated `IRW0004_CamelPhat_YouTubeVideo.editor.csv` (V1 + paused V2, £8.80 Daily, Target CPV £0.03, business name Ironworks).
