# Session log — pr-pending-cursor-mailchimp-as-reg-source

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-as-reg-source`

## Summary

Three-part fix: switches the Daily Tracker REGS column source from `meta_regs` (Meta-pixel only) to Mailchimp tag deltas, wires the snapshots to the tracker for non-brand events, and replaces PR #622's meta_regs backwards-walk with a snapshot-anchored linear ramp for the pre-snapshot window.

## Root cause

PR #622's `syncMailchimpTagDailyHistory` walked backwards using `event_daily_rollups.meta_regs` as the daily registration delta. Meta REGs only capture Meta-attributed clicks — they miss TikTok, Google, organic and direct signups. For Camelphat: 1,380 Meta REGS vs 2,339 real Mailchimp tag count (≈40% under-count). The curve was systematically wrong.

Separately, the Daily Tracker REGS column read `meta_regs` from the rollup — same Meta-only signal, same ~40% miss.

## What changed

### `lib/mailchimp/compute-registrations.ts`
Added optional `raw_json?: Record<string, unknown> | null` to `MailchimpSnapshotRow`. Needed so the tracker can identify and exclude `linear_ramp_pre_snapshot` rows from delta computation.

### `app/api/events/[id]/mailchimp/snapshots/route.ts`
Added `raw_json` to the Supabase select for tag snapshot rows so it flows through to callers.

### `lib/mailchimp/sync.ts` — `syncMailchimpTagDailyHistory` (third rewrite)

New algorithm:
1. Read all existing `mailchimp_tag_snapshots` rows for the event; group by day keeping latest per day; exclude previous `linear_ramp_pre_snapshot` rows from grouping
2. Find earliest `event_daily_rollups` row (campaign start)
3. If campaignStart < firstSnapshotDay: build linear-ramp rows from 0 → firstSnapshotValue across the pre-snapshot window (`method: "linear_ramp_pre_snapshot"`)
4. Delete ALL existing `source=mailchimp_tag_daily_history` rows (idempotent cleanup of PR #622 backwards-walk rows and any old ramp rows)
5. Insert new ramp rows (if any)

The ramp rows serve the chart (believable visual curve from campaign launch → first real snapshot). They are excluded from the tracker's delta computation so the REGS column still shows "—" for those days.

### `components/dashboard/events/event-daily-report-block.tsx`

Changed `controlled.mailchimpSnapshots` from `shareMailchimpSnapshots` (brand campaign share page only) to `shareMailchimpSnapshots ?? chartMailchimpRows`. This wires the Mailchimp snapshot data to the DailyTracker for all non-brand tag-scoped events on the dashboard. Added `chartMailchimpRows` to the `controlled` memo dependency array.

### `components/dashboard/events/daily-tracker.tsx`

1. Added `import type { MailchimpSnapshotRow }` from compute-registrations.
2. Updated `controlled.mailchimpSnapshots` type from inline shape to `ReadonlyArray<MailchimpSnapshotRow>` (picks up the new `raw_json` field).
3. In `buildDisplayRows`: added `realSnapshotsForRegs` (filters out `linear_ramp_pre_snapshot` rows). When non-null and non-brand, sets `meta_regs` to `netNewMailchimpRegistrationsForDay(realSnapshotsForRegs, r.date)` instead of rollup's `r.meta_regs`. Falls back to `r.meta_regs` when no Mailchimp snapshots are available.
4. In `buildWeeklyDisplayRows`: same pattern — uses `netNewMailchimpRegistrationsForWeek(realSnapshotsForRegs, wk)` for `meta_regs` when snapshots are present.

## Expected outcomes (Camelphat / IRW0004)

After next mailchimp/refresh:
- Ramp rows written for 2026-06-16, 2026-06-17 (pre-snapshot days)
- Previous backwards-walk rows cleaned up

Daily Tracker REGS column:
- 21 Jun: ~421 (2,339 − 1,918)
- 20 Jun: ~622 (1,918 − 1,296)
- 19 Jun: ~340 (1,636 − 1,296)
- 18 Jun: 1,296 (first real snapshot, no prior → 1,296 − 0)
- 17 Jun: — (ramp row excluded from delta; no real prior)
- 16 Jun: — (ramp row excluded from delta; no real prior)

Daily Trend chart: green Registrations line extends from 16 Jun (0) → linear ramp → 18 Jun (1,296) → real snapshots → 21 Jun (~2,339)

## Checklist

- [x] `npm run build` — clean
- [x] `npx eslint ...` — 0 warnings
