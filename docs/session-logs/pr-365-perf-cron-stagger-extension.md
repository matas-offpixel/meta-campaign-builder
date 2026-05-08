# Session log — perf/cron-stagger-extension (PR-F)

## PR

- **Number:** #365
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/365
- **Branch:** `perf/cron-stagger-extension`

## Summary

Stretch the Meta cron stagger from a 30-min window per cycle to a
90-min window so any single ad-account never has more than one
Meta cron firing within a 30-min slot. Eases Meta's hourly
budget-pacing pressure (the rate-limit policy that throttles us
when too many calls cluster in a single 60-min window).

## Schedule (post-PR-F)

```
sync-ticketing            00 6,10,14,18,22  (5×, base + show-week, ticketing only — unchanged)
refresh-creative-insights 30 6,12,18        (3×)
rollup-sync-events        00 7,13,19        (3×, +30 min from insights)
refresh-active-creatives  30 7,13,19        (3×, +30 min from rollup)
show-week-burst           00 9,15,21        (3×, separate hour from base burst)
```

Within any single 30-min window only one Meta-touching cron is
firing. Across a single base cycle the three legs span 06:30 →
07:30 (90 min), 12:30 → 13:30, 18:30 → 19:30. The burst leg sits
at 09:00 / 15:00 / 21:00 — between cycles, never overlapping the
base trio.

## Scope / files

- `vercel.json` — only file changed. New schedule is the table
  above.

## Validation

- [x] `npm test` — passes (no code touched, only schedule
      strings).
- [x] `npm run build` — clean (config-only change).
- [x] No new lint warnings.
- [ ] Vercel Cron settings page reflects the new times after
      deploy.
- [ ] Sanity-check post-deploy: in any 30-min period at most one
      Meta cron fires per ad-account.
- [ ] Cron logs continue to show `all_ok=true` for at least 24h
      post-deploy.

## Notes

- `sync-ticketing` keeps its 5×/day cadence on the original `00`
  minute mark — Eventbrite has its own rate-limit budget separate
  from Meta and ticket data is the live signal.
- TikTok crons (`tiktok-active-creatives`, `tiktok-breakdowns`)
  are untouched — they hit a separate API and a separate per-app
  budget.
- The internal `scan-enhancement-flags`, `d2c-send`,
  `funnel-pacing-refresh`, `benchmark-alerts` crons are
  Supabase-only and left alone.
- This is intentionally a config-only change — runtime behaviour
  of every individual route is unchanged. Result: identical
  per-cron Meta call counts, but spread across a wider window so
  the burst rate per ad-account per hour drops by ~3×.
