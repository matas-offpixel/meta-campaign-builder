## PR

- **Number:** 352
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/352
- **Branch:** `feat/venue-report-share-and-thumbnail-proxy` (squash-merged)

## Summary

Adds Supabase Storage-backed Meta creative thumbnail caching (`creative-thumbnails` bucket, 7-day cache-control), a canonical GET `/api/proxy/creative-thumbnail` handler (legacy `/api/meta/thumbnail-proxy` delegates), cron-side warming after each successful active-creatives snapshot write, client-portal Share button in the venue sticky header (POST `/api/share/client`, clipboard + toast, ⌘⇧S), Daily Tracker chrome trimmed for the venue embed (no local Sync / cadence — uses global timeframe via filtered timeline + `reportEmbed`), Reach disclaimer collapsed to an (i) tooltip on the stats grid, and Meta-blue placeholder tiles when thumbnails fail.

## Scope / files

- `supabase/migrations/068_creative_thumbnails_bucket.sql` — public-read bucket for cached JPEG/PNG/WebP/GIF
- `lib/meta/creative-thumbnail-pure.ts`, `creative-thumbnail-cache.ts`, `creative-thumbnail-get.ts`, `creative-thumbnail-warm.ts`
- `app/api/proxy/creative-thumbnail/route.ts`, `app/api/meta/thumbnail-proxy/route.ts` (delegate)
- `app/api/cron/refresh-active-creatives/route.ts` — warm thumbnails after every snapshot write (before optional AI autotag)
- `lib/dashboard/meta-thumbnail-proxy-url.ts` — canonical proxy URL + `fallback_label`
- `components/share/share-active-creatives-client.tsx` — skeleton load, Meta placeholder, keyed remount
- `components/share/venue-report-header.tsx` — Share + toast + shortcut
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — `shareClientId`
- `components/dashboard/events/daily-tracker.tsx`, `components/share/venue-daily-report-block.tsx` — `reportEmbed`
- `components/share/venue-stats-grid.tsx` — Reach tooltip
- `lib/meta/thumbnail-proxy-server.ts` — removed unused `unstable_cache` path (Storage replaces 24h Next cache)

## Validation

- [x] `npm test` (801 pass)
- [x] `npm run build`
- [x] ESLint on touched files
- [ ] Apply migration `068` on Supabase before relying on Storage in production

## Notes

- Share button only renders when `pathname.startsWith('/clients/')` and `shareClientId` is set — hidden on `/share/*`.
- `cache_key` query param resolves an object name inside the bucket without Meta (optional CDN-style path); primary path remains `ad_id` + session or share auth.
