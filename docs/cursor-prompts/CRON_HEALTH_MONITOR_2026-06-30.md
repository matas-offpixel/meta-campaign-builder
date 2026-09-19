# Cron silent-failure monitor (admin page version)

**Tag:** `[Cursor, Sonnet]` *(mechanical scope; Sonnet is enough)*
**Branch:** `cursor/ops/cron-health-monitor`
**Scope target:** ~5-7 files, single PR
**Prereq:** none — uses existing tables

## Why this PR

We now have 15 crons writing to snapshot/rollup tables. Memory `feedback_vercel_log_filtering_console_error_only` shows Vercel filters `console.log/warn` under load — cron failures go silent and the dashboard shows stale data. The Mailchimp build hit several "the chart looks wrong" incidents from exactly this.

Today we shipped a 15th cron (`refresh-client-portal-snapshots`) and the cache literally serves stale data if the cron stops running. **The risk is now actively load-bearing on the dashboard's perceived correctness.**

This PR is a low-effort monitor: a meta-cron writes a "staleness report" every 30 min listing which snapshot tables have rows older than expected. An admin page renders the report. You/Sarah glance daily.

## Paste this into Cursor (Sonnet)

```
GOAL
Build a cron silent-failure monitor that surfaces stale snapshot/rollup tables. Single new admin page + single new meta-cron + new tracking table. No external integrations (Slack deferred). Sonnet scope: mechanical implementation of a well-defined spec.

GROUNDING (DO NOT INVENT — VERIFIED 2026-06-30)
- 15 crons live today in app/api/cron/: benchmark-alerts, d2c-send, funnel-pacing-refresh, mailchimp-backfill-tick, mailchimp-eod-snapshot, refresh-active-creatives, refresh-client-portal-snapshots, refresh-creative-insights, rollup-sync-events, show-week-burst, snapshot-tier-channel-sales-daily, sync-mailchimp-audiences, sync-ticketing, tiktok-active-creatives, tiktok-breakdowns.
- Snapshot/rollup tables that should be monitored (read each migration to confirm column names — the schema may have drifted from this prompt):
  * active_creatives_snapshots (mig 041) — column: refreshed_at — expected freshness: 12h (6h cron + grace)
  * tiktok_active_creatives_snapshots (mig 057) — column: refreshed_at — expected: 12h
  * client_portal_snapshots (mig 123) — column: refreshed_at — expected: 30 min
  * event_daily_rollups (mig 039) — column: updated_at OR last_synced_at — expected: 6h
  * audience_source_cache (mig 087) — column: refreshed_at — expected: 24h
  * share_insight_snapshots (mig 037 + earlier) — column: refreshed_at — expected: 6h
  * tiktok_breakdown_snapshots (mig ~101) — column: refreshed_at — expected: 12h
  * mailchimp_tag_snapshots (mig 118 + 119 era) — column: snapshot_at — expected: 24h
- Memory: feedback_vercel_log_filtering_console_error_only — use console.error not console.log/warn for cron diagnostics.
- Memory: feedback_use_mcps_not_assumptions — verify each table actually exists before adding to the monitor. Run a SELECT 1 FROM {table} LIMIT 1 to confirm before committing the table to the monitor's TABLE_CONFIG.
- CLAUDE.md: cron auth pattern is bearer CRON_SECRET, identical to all other crons in the codebase. Mirror it.
- CLAUDE.md: /api/cron/* is already in PUBLIC_PREFIXES so middleware won't block.
- Migration 123 is the latest. Claim 124 for the new tracking table.

WHAT TO BUILD

1. supabase/migrations/124_cron_health_reports.sql (NEW)
   - Single table: cron_health_reports
     - id uuid primary key default gen_random_uuid()
     - generated_at timestamptz not null default now()
     - report_jsonb jsonb not null  -- { tables: [{ name, last_refreshed_at, age_minutes, threshold_minutes, status: 'fresh'|'stale'|'missing' }] }
     - any_stale boolean not null default false  -- denormalised for quick filtering
   - Index: idx_cron_health_reports_recent (generated_at desc)
   - RLS: enable. SELECT policy: authenticated users only (no per-user scoping needed — admin dashboard data).
   - No INSERT/UPDATE/DELETE policy — service-role writes only.

2. lib/reporting/cron-health-monitor.ts (NEW)
   - export `runCronHealthCheck(): Promise<{ tables: TableStatus[], anyStale: boolean }>`
   - export type `TableStatus = { name: string; lastRefreshedAt: string | null; ageMinutes: number | null; thresholdMinutes: number; status: 'fresh' | 'stale' | 'missing' }`
   - Internal const: TABLE_CONFIG = array of { table: string, freshColumn: string, thresholdMinutes: number }
   - For each entry: service-role SELECT MAX(${freshColumn}) FROM ${table}. Compute age_minutes from now - max. Mark fresh if age < threshold, stale if >, missing if no rows or query fails.
   - Use console.error for any per-table query failures (single line, key=value style).
   - Return assembled status object.

3. app/api/cron/cron-health-check/route.ts (NEW)
   - GET handler. Bearer CRON_SECRET auth identical to refresh-client-portal-snapshots.
   - Calls runCronHealthCheck.
   - Writes one row to cron_health_reports via service-role.
   - Returns JSON: { ok: boolean, anyStale: boolean, tables: [...] }, status 200 always (even on stale — staleness is the data, not a failure).
   - export const maxDuration = 60.
   - Add to vercel.json: schedule "*/30 * * * *" (every 30 min).

4. app/(dashboard)/admin/cron-health/page.tsx (NEW)
   - Server component. Auth: same admin gate as other /admin/* routes (read an existing admin page for the pattern — DO NOT invent).
   - Reads the latest cron_health_reports row.
   - Renders a table: each row = one monitored snapshot table with name, last_refreshed_at, age, status badge (green=fresh, amber=stale, red=missing).
   - Shows generated_at of the report at the top.
   - Manual refresh button: POST to /api/admin/cron-health-check (new route below) which triggers runCronHealthCheck inline and writes a new report.
   - If no report exists yet (cron hasn't run): show a "no reports yet" message + the manual trigger button.

5. app/api/admin/cron-health-check/route.ts (NEW)
   - POST handler. Admin-only auth (cookie session, same pattern as other /api/admin/* routes).
   - Calls runCronHealthCheck.
   - Writes one row to cron_health_reports via service-role.
   - Returns the new report's JSON.
   - export const maxDuration = 60.

6. PR description must include:
   - Confirmation of every table in TABLE_CONFIG was verified to exist + the freshness column was confirmed.
   - Sample output of runCronHealthCheck run locally (so we can see the current state at PR time — useful baseline).
   - Note any tables that I missed in this prompt that should be added.
   - Note any tables in this prompt that don't actually exist or have a different freshness column.

CONSTRAINTS — STRICT
- DO NOT add Slack / webhook integration. Deferred.
- DO NOT add email alerts. Deferred.
- DO NOT change any other cron's behaviour. Read-only on existing infrastructure.
- DO NOT use Promise.all for the per-table queries — sequential (memory: Supabase burstable cascade pattern still applies; we're on Nano).
- DO NOT use console.log/warn. console.error only.
- Apply migration via mcp__supabase__apply_migration, NOT execute_sql (memory: feedback_migration_workflow_discipline).
- Match existing TypeScript strict mode, ESLint config, import patterns.

VALIDATION GATE
- npm run build: exit 0.
- npm run lint: clean on touched files.
- Migration applied via Supabase MCP. Verify table exists.
- Local: trigger /api/admin/cron-health-check manually. Confirm a row is written to cron_health_reports.
- Local: open /admin/cron-health. Confirm the page renders without error and shows the staleness data.
- Sample output of the first report in PR description.

ASK BEFORE DOING IF
- Any table in TABLE_CONFIG doesn't exist in the current schema — surface it, ask whether to drop it or wait.
- The admin auth pattern is different than expected — surface and confirm before mirroring.
- The freshness column on event_daily_rollups is ambiguous (updated_at vs last_synced_at vs both) — surface and confirm which one to use.
- A snapshot table I missed comes up in the audit — surface it for inclusion.

OUT OF SCOPE — DO NOT BUILD HERE
- Slack alerts.
- Email alerts.
- Auto-restart of failed crons.
- Historical trend chart of cron health over time.
- Any change to existing cron logic.
- Anything Remotion / unrelated.
```

## After Cursor opens the PR

1. Verify the sample output in the PR description shows real freshness data on at least 6 tables.
2. If `client_portal_snapshots` shows as missing, that's expected — the cron from PR #644 hadn't fired yet at the time of test. Acceptable.
3. Merge with squash.
4. After merge: visit `/admin/cron-health` once a day for the first week. If something's stale, that's the signal to investigate.

## Why this is the right shape

- **Catches failures within 30 minutes** of the next normal-cron tick after they happen.
- **No external dependencies** (no Slack webhook, no email service to set up).
- **Self-contained** — one new table, one new cron, one new page, one new admin route.
- **Read-only on existing infrastructure** — won't break any current cron.
- **Foundation for Slack later** — when you have time, adding a webhook to the cron's response is a small follow-up PR. The hard work (knowing what to alert on) is done here.
