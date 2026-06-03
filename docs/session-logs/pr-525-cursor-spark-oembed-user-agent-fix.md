# PR #525 — fix(tiktok): Spark Ad OEmbed needs browser User-Agent + error-level logging

**Branch:** `cursor/spark-oembed-user-agent-fix`
**PR:** pending
**Date:** 2026-06-03

## Problem

After PR #524 switched `fetchSparkAdInfo` to TikTok's public OEmbed endpoint, Spark Ad thumbnails
still didn't resolve in production (0/18 rows). Crucially, **none** of the diagnostic logs from
`fetchSparkAdInfo` appeared in Vercel — not the entry `console.log`, not the `console.warn` on
non-OK status, not the catch. Three possible causes:

1. TikTok's OEmbed endpoint blocked requests with the bare Node.js fetch `User-Agent` (no UA or
   `node-fetch/X`), returning a non-200 silently before any log fired.
2. Vercel's log indexer filtered `console.log`/`console.warn` patterns under load (already
   observed in PR #514).

## Fix

### `lib/tiktok/share-render.ts`

Rewrote `fetchSparkAdInfo` with:

- **Browser `User-Agent` header** — matches what curl/browser send locally where OEmbed works:
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...`
- **`Accept: application/json` header** for good measure.
- **Text-then-parse body reading** — `res.text()` first, then `JSON.parse(bodyText)`, giving us
  the raw body in logs when things go wrong.
- **`console.error` throughout** (entry, per-item success/failure, catch) — Vercel reliably
  surfaces `error`-level logs; `log`/`warn` can silently disappear under load.

### `lib/tiktok/__tests__/share-render.test.ts`

Updated the existing Spark Ad test to:
- Accept `init?: RequestInit` in the fetch mock so it can inspect headers.
- Assert `User-Agent` includes `"Mozilla"` — guarantees future regressions are caught.

### `supabase/migrations/108_ironworks_spark_backfill_2.sql`

Deletes `thumbnail_url IS NULL` rows for the Ironworks event so the next cron run retries
thumbnail resolution with the fixed code.

## Files changed

| File | Change |
|------|--------|
| `lib/tiktok/share-render.ts` | Browser UA + Accept headers; text→JSON parsing; console.error |
| `lib/tiktok/__tests__/share-render.test.ts` | Assert UA header sent in OEmbed fetch |
| `supabase/migrations/108_ironworks_spark_backfill_2.sql` | Force re-fetch after deploy |

## Tests

```
✔ resolves Spark Ad thumbnails via OEmbed when video_id is absent
8/8 pass
```

## Post-deploy steps

1. Migration `108` runs automatically on next deploy.
2. Check Vercel runtime logs for `[spark-oembed] start: 3 items to resolve`.
3. After next cron: `SELECT COUNT(*) FROM tiktok_active_creatives_snapshots WHERE event_id = '68535c85-0394-435f-9439-245dd2e87043' AND thumbnail_url IS NOT NULL;` — should be 34.
