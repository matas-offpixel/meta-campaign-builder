# Session log — chart collapse per-day snapshots

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/chart-collapse-per-day-snapshots`

## Summary

Fixes duplicate date labels on the Daily Trend x-axis for tagged events (Charlotte
de Witte, Camelphat, Appetite, Eric Prydz). Two distinct root causes were found and
fixed together:

**Bug A (x-axis duplication — primary visible symptom):** When an event has
Mailchimp snapshot data but no spend rollup rows yet (`base` is empty), the
`LegacyTrendChart` x-axis extension adds snapshot dates to both `extraBefore`
(dates before first base date) AND `extraAfter` (dates after last base date)
because both conditions reduce to `null == null → true`. Each set is deduplicated
individually, so the result is the same 3 dates appearing twice:
"24 Jun → 25 Jun → 26 Jun → 24 Jun → 25 Jun → 26 Jun". Fixed by excluding
`extraBefore` dates from `extraAfter`.

**Bug B (defensive correctness for brand_campaign chart):** `buildMailchimpRegistrationSnapshotPoints`
emitted one chart point per snapshot row. When two snapshots land on the same day
(EOD cron at 23:55 + tag-sync at ~06:00 UTC), two `{date: "2026-06-25", ...}`
points were produced. The aggregator handled this correctly (last write wins for
`cumulative_snapshot` kind) but was order-dependent. Fixed by collapsing to the
highest-value row per day before mapping.

## Scope / files

- `lib/mailchimp/compute-registrations.ts` — adds exported
  `collapseSnapshotsToOnePerDay(snapshots)` pure helper; co-located with the
  `MailchimpSnapshotRow` type so it's easily tested in isolation
- `lib/dashboard/venue-trend-points.ts` — imports `collapseSnapshotsToOnePerDay`
  and calls it at the top of `buildMailchimpRegistrationSnapshotPoints`
- `components/dashboard/events/event-trend-chart.tsx` — `LegacyTrendChart`
  x-axis extension: build `extraBeforeSet` from `extraBefore` and add
  `!extraBeforeSet.has(d)` to the `extraAfter` filter

## Validation

- [x] tsc shows no errors in modified files (pre-existing `.next/dev` framework
  noise only)
- [ ] `npm run build`
- [ ] `npm test`

## Notes

- `collapseSnapshotsToOnePerDay` is a pure function (no server-only import) and
  can be exercised in unit tests without DB setup.
- When `base` is non-empty, `extraBefore` and `extraAfter` are already mutually
  exclusive by date range, so the `!extraBeforeSet.has(d)` guard is a no-op for
  those cases — zero regression risk.
- The `mailchimpMap` in `LegacyTrendChart` (lines 222-229) already performs
  last-write-wins per day keying — no change needed there.
