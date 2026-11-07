# Session log

## PR

- **Number:** 1097
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1097
- **Branch:** `cursor/learning-copy-capture`

## Summary

Per-ad copy for the learning layer. The nightly insights run reads each new or stale ad's creative in batches of 50, and snapshots or drafts fill only the ads Graph did not return. Lab launch does not write copy in this PR.

## Scope / files

- `supabase/migrations/206_ad_copy.sql` — written, not applied. No authenticated read.
- `lib/ad-daily-insights/copy.ts`, `copy-capture.ts`, `runner.ts`
- `scripts/backfill-ad-copy.mts`
- `CLAUDE.md` — `ENABLE_AD_COPY_CAPTURE`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] Backfill dry-run against production (read-only). `ad_copy` is not applied, so every distinct insight ad is due: 10,675 ads, 216 calls, 8 accounts.

## Notes

Open "copy" PRs are other work (D2C, community alias, asset queue). None of them capture per-ad Meta copy. Graph `/?ids=` was removed in v26, so the read uses the Batch API replacement the insights job already uses. The Lab-launch write is deferred.
