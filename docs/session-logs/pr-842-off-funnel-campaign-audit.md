# Session log

## PR

- **Number:** 842
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/842
- **Branch:** `cursor/off-funnel-campaign-audit`

## Summary

Phase B.3 — list live campaigns that still point off-funnel while their event has an instrumented landing page. Snapshot-only (no new platform reads). No in-place destination write: Meta creatives cannot change URL; TikTok update is unsafe from snapshot fields. Action is “Relaunch with event page”.

## Scope / files

- `lib/dashboard/off-funnel-audit.ts` + candidates + tests
- `lib/db/off-funnel-audit-load.ts` — Meta `active_creatives_snapshots.payload.groups[].representative_preview.link_url`; TikTok `tiktok_active_creatives_snapshots.deeplink_url`
- `GET /api/events/[id]/off-funnel`
- Event report funnel (internal only)

## Validation

- [x] `npm run build` (includes `/api/events/[id]/off-funnel`)
- [x] lint on changed files (0 new errors)
- [x] `npm test` — 4399 tests, 4396 pass, 0 fail, 3 skipped

## Notes

- Meta source: AdCreative update params name/status/adlabels only.
- TikTok source: AdupdateCreatives.landing_page_url exists; full-ad update not safe from snapshots.
- Out of scope: bulk-attach LP defaults, click-ID joins, auto-migration, pause/budget writes.
