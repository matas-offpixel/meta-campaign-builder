-- Migration 126 — cron_health_reports
--
-- (Filed as 126: prod ledger applied this as `124_cron_health_reports`
--  on 2026-06-30, but the d2c branch's 124_d2c_orchestration +
--  125_d2c_brief_ingest landed on main's migrations/ dir afterward, so 124/125
--  are taken on disk. 126 is the next free integer on disk; the prod apply is
--  timestamp-versioned so the on-disk renumber is cosmetic — no re-apply.)
--
-- Backing store for the cron silent-failure monitor. Each row is one
-- point-in-time health report produced by `runCronHealthCheck`
-- (lib/reporting/cron-health-monitor.ts): it samples MAX(<freshness column>)
-- across the snapshot/rollup tables that crons are supposed to keep warm and
-- flags any whose most-recent write is older than its expected cadence.
--
-- Written by:
--   * GET  /api/cron/cron-health-check   (Vercel Cron, every 30 min)
--   * POST /api/admin/cron-health-check  (admin "Refresh now" button)
-- Read by:
--   * /admin/cron-health  (admin dashboard table)
--
-- RLS: any authenticated user may SELECT (this is operator/admin dashboard
-- data, no per-user scoping). Writes are service-role only — no
-- INSERT/UPDATE/DELETE policy, so the cron / admin writer (service-role,
-- bypasses RLS) is the only path that can add rows.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: `if not exists` + catalog-checked DO blocks throughout.

create table if not exists cron_health_reports (
  id           uuid        primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  -- { tables: [{ name, last_refreshed_at, age_minutes, threshold_minutes,
  --             status: 'fresh' | 'stale' | 'missing' }] }
  report_jsonb jsonb       not null,
  -- Denormalised flag for quick "is anything broken right now" filtering
  -- without unpacking the jsonb.
  any_stale    boolean     not null default false
);

-- Read-path index: latest report first.
create index if not exists idx_cron_health_reports_recent
  on cron_health_reports (generated_at desc);

-- ── RLS — authenticated read, service-role write ─────────────────────
alter table cron_health_reports enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cron_health_reports'
      and policyname = 'authenticated read cron health reports'
  ) then
    execute
      'create policy "authenticated read cron health reports" '
      'on cron_health_reports for select '
      'to authenticated using (true)';
  end if;
end $$;

comment on table cron_health_reports is
  'Point-in-time cron silent-failure reports. report_jsonb holds per-table freshness/staleness; any_stale denormalises the alert flag. Written by /api/cron/cron-health-check + /api/admin/cron-health-check (service-role), read by /admin/cron-health. Migration 126 (applied to prod as 124_cron_health_reports).';

notify pgrst, 'reload schema';
