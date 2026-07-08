-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 143 — reset pre-existing autoresp_setup sends to the new
-- webhook/poll-driven semantics (Goal 8).
--
-- Before this arc, `autoresp_setup` sends were fired as a one-off broadcast at
-- approve-time. The rewrite makes them PERSISTENT autoresponders that are
-- "armed" (result_jsonb.autoresp_config.enabled = true) rather than fired. Any
-- send created before the rewrite has no autoresp_config, so this migration:
--   * seeds an inactive config (enabled=false) — Matas must explicitly ARM each
--     one in the operator dashboard,
--   * resets approval to pending_approval + status to scheduled so the card
--     shows the "Arm autoresponder" control.
--
-- SPEC CORRECTION vs the original brief: the brief asked to set
-- `scheduled_for = null`. `d2c_scheduled_sends.scheduled_for` is NOT NULL
-- (schema line ~418), so it CANNOT be nulled. It doesn't need to be: the
-- `/api/cron/d2c-send` loop now SKIPS every `autoresp_setup` row regardless of
-- scheduled_for (see the guard in that route), so the stale timestamp is inert.
--
-- Idempotent + environment-safe: only touches rows that lack an autoresp_config
-- (so re-running is a no-op, and a fresh/CI DB with no such rows is unaffected).
-- This naturally targets the two live rows — Throwback Algarve + Hop on the Top
-- Porto — without hardcoding their event ids.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration` (same flow as
-- migrations 141 / 142).
-- ─────────────────────────────────────────────────────────────────────────────

update public.d2c_scheduled_sends
set
  approval_status = 'pending_approval',
  status = 'scheduled',
  result_jsonb = coalesce(result_jsonb, '{}'::jsonb)
    || jsonb_build_object(
      'autoresp_config',
      jsonb_build_object('enabled', false, 'armed_at', null, 'armed_by', null)
    ),
  updated_at = now()
where job_type = 'autoresp_setup'
  and (result_jsonb -> 'autoresp_config') is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: every autoresp_setup row now carries an autoresp_config.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.d2c_scheduled_sends
  where job_type = 'autoresp_setup'
    and (result_jsonb -> 'autoresp_config') is null;
  if v_missing <> 0 then
    raise exception 'migration 143 verification: % autoresp_setup rows still missing autoresp_config', v_missing;
  end if;
  raise notice 'migration 143 verification: all autoresp_setup rows carry an autoresp_config';
end $$;
