# Session log — TikTok active creatives dedupe

## PR

- **Number:** 604
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/604
- **Branch:** `cursor/tiktok-active-creatives-dedupe`

## Summary

Follow-up to PR #603. The same multi-window accumulation pattern that
caused 15–18× duplicate rows in the demographics tables also affected
`tiktok_active_creatives_snapshots` — each ad_id had ~15 rows (one per
daily cron window), so the ACTIVE CREATIVES grid was showing 30+ duplicate
cards instead of the ~10 aggregated creative concepts. Mirror the exact fix
from #603: add `window_until` to the select, sort newest-first, deduplicate
by `ad_id` in JS, strip `window_until` before casting to the component type.

## Scope / files

- `app/share/report/[token]/page.tsx` — add `window_until` to active
  creatives select; sort `window_until DESC, fetched_at DESC`; deduplicate
  by `ad_id` before casting to `TikTokSnapshotCreative[]`

## Validation

- [x] `npx tsc --noEmit --skipLibCheck` — zero new errors
- [ ] Visit `/share/report/af1e8e47ec993550dbfb8f2e96b69364` → ACTIVE CREATIVES shows ~10 cards (not 30+)
- [ ] VIDEO VIEWS campaign total corrects to ~370K

## Notes

Single-file change, direct mirror of the breakdowns dedupe in #603. No
schema changes, no new dependencies.
