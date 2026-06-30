# Session log — cron silent-failure monitor

## PR

- **Number:** 646
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/646
- **Branch:** `cursor/ops/cron-health-monitor`

## Summary

Adds a cron silent-failure monitor that surfaces stale snapshot/rollup tables —
the class of failure where a cron silently 401s / times out / no-ops for days
and nobody notices. A new `*/30` meta-cron samples `MAX(<freshness column>)`
across 8 cron-managed tables, classifies each `fresh | stale | missing` against
its expected cadence, and writes a `cron_health_reports` row. A new
`/admin/cron-health` page renders the latest report with status badges + a
manual "Refresh now" trigger. No Slack/email (deferred), no changes to any
existing cron's behaviour (read-only on existing infrastructure).

## Scope / files

- `supabase/migrations/126_cron_health_reports.sql` (NEW) — tracking table, RLS
  (authenticated read / service-role write), `generated_at desc` index.
- `lib/reporting/cron-health-monitor.ts` (NEW) — `runCronHealthCheck()` +
  `writeCronHealthReport()`, `TABLE_CONFIG`, `TableStatus` type. Sequential MAX
  queries, `console.error` only.
- `app/api/cron/cron-health-check/route.ts` (NEW) — GET, bearer `CRON_SECRET`,
  always 200, `maxDuration = 60`.
- `app/api/admin/cron-health-check/route.ts` (NEW) — POST, cookie session auth,
  `maxDuration = 60`.
- `app/(dashboard)/admin/cron-health/page.tsx` (NEW) — server component, session
  gate, table + badges + empty-state.
- `components/admin/cron-health-refresh-button.tsx` (NEW) — client refresh button.
- `vercel.json` — added `/api/cron/cron-health-check` `*/30 * * * *`.

## TABLE_CONFIG verification (live schema, 2026-06-30)

All 8 tables exist + are queryable. **5 freshness columns drifted from the
spec** — the spec said `refreshed_at` for the snapshot tables, but most expose
`fetched_at`. Verified via `information_schema.columns` and a `MAX()` probe:

| table | column used | threshold | spec said |
|---|---|---|---|
| client_portal_snapshots | `refreshed_at` | 30m | refreshed_at ✓ |
| event_daily_rollups | `updated_at` | 6h | updated_at / last_synced_at → **no `last_synced_at` exists**, used `updated_at` |
| active_creatives_snapshots | `fetched_at` | 12h | refreshed_at ✗ → `fetched_at` |
| tiktok_active_creatives_snapshots | `fetched_at` | 12h | refreshed_at ✗ → `fetched_at` |
| tiktok_breakdown_snapshots | `fetched_at` | 12h | refreshed_at ✗ → `fetched_at` |
| share_insight_snapshots | `fetched_at` | 6h | refreshed_at ✗ → `fetched_at` |
| audience_source_cache | `fetched_at` | 24h | refreshed_at ✗ → `fetched_at` |
| mailchimp_tag_snapshots | `snapshot_at` | 24h | snapshot_at ✓ |

## Sample report (first run, 2026-06-30 22:22 UTC)

`anyStale = true`. Two tables flagged stale — real signal the monitor exists to
catch:

| table | status | age | threshold |
|---|---|---|---|
| client_portal_snapshots | fresh | 5m | 30m |
| event_daily_rollups | fresh | 70m | 6h |
| active_creatives_snapshots | fresh | 68m | 12h |
| tiktok_active_creatives_snapshots | fresh | 229m | 12h |
| tiktok_breakdown_snapshots | fresh | 214m | 12h |
| **share_insight_snapshots** | **stale** | 4.3d | 6h |
| **audience_source_cache** | **stale** | 47d | 24h |
| mailchimp_tag_snapshots | fresh | 16h | 24h |

## Notes / findings (for reviewer)

- **`share_insight_snapshots` is traffic-driven, not cron-driven.** It's
  written on share-page views (stale-while-revalidate), so MAX(fetched_at)
  tracks "last share-page view" not a cron. A 6h threshold flags it whenever no
  share page is opened for >6h, which is normal. Kept it in the monitor per the
  spec, but consider raising its threshold or dropping it — it will read "stale"
  often without indicating a failure.
- **`audience_source_cache` last written 2026-05-14 (47 days).** Either the
  feature is dormant or its writer genuinely stopped. Worth a look — exactly the
  silent failure this monitor is for.
- **Overnight cadence gaps.** `event_daily_rollups` (rollup-sync at 07/13/19)
  and the `*_creatives_snapshots` (07/13/19) have ~12h overnight gaps. The 6h
  rollup threshold may flag stale every morning before the 07:00 run. Thresholds
  kept as specified; flagging for a possible tuning follow-up.
- **`any_stale` semantics:** set true when any table is `stale` OR `missing`
  (i.e. not `fresh`) — the useful "needs attention" flag.
- **Migration numbering:** filed on disk as `126` because the d2c branch's
  `124`/`125` migrations landed on `main` after PR #644; the prod apply
  (via MCP) is recorded under the unique timestamp version with name
  `124_cron_health_reports`. On-disk renumber is cosmetic, no re-apply.

## Validation

- [x] `npm run build` — exit 0; routes `/admin/cron-health`,
  `/api/admin/cron-health-check`, `/api/cron/cron-health-check` registered.
- [x] `npm run lint` — clean on all touched files.
- [x] Migration applied via Supabase MCP `apply_migration`; table verified
  (4 cols, 1 RLS policy, 1 index).
- [x] Ran `runCronHealthCheck()` + `writeCronHealthReport()` end-to-end
  (sequential, 3.7s); `cron_health_reports` row written with correct JSON shape.
- [x] Route auth gates: cron GET w/o bearer → 401; admin POST + page w/o
  session → 307 `/login`.
- [ ] **Human:** open `/admin/cron-health` while signed in and confirm the
  table renders with badges (the headless browser here has no session — same
  auth-gate limitation as the PR #643 DevTools capture). Data path + page
  compilation are already verified.
