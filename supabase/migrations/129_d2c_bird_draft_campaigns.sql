-- 129_d2c_bird_draft_campaigns.sql
--
-- Bird broadcast pivot (PR: d2c/bird-broadcast-drafts).
--
-- Broadcast job types (announce / reminder / presale_live / gen_sale) that go
-- out over WhatsApp to signup segments now create a Bird *draft campaign* for
-- Matas to review, add audiences, proof-test and fire manually in the Bird UI —
-- instead of firing directly via the API. Low-blast personalised sends
-- (autoresp_setup / community_early) stay direct-fire.
--
-- This migration adds:
--   1. status enum value 'draft_ready' — a Bird draft campaign exists and is
--      awaiting Matas review + manual fire (terminal for the cron; it never
--      auto-fires a draft_ready row).
--   2. bird_campaign_id       — Bird campaign resource id once the draft exists.
--   3. bird_campaign_edit_url — deep link into Bird Studio for review.
--
-- Reversibility:
--   alter table d2c_scheduled_sends
--     drop column if exists bird_campaign_id,
--     drop column if exists bird_campaign_edit_url;
--   alter table d2c_scheduled_sends drop constraint if exists d2c_scheduled_sends_status_check;
--   alter table d2c_scheduled_sends add constraint d2c_scheduled_sends_status_check
--     check (status in ('scheduled','sent','failed','cancelled'));
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend the status CHECK with 'draft_ready'. The original constraint
--    (migration 030) is an inline, Postgres-named check.
alter table d2c_scheduled_sends
  drop constraint if exists d2c_scheduled_sends_status_check;

alter table d2c_scheduled_sends
  add constraint d2c_scheduled_sends_status_check
  check (status in ('scheduled', 'sent', 'failed', 'cancelled', 'draft_ready'));

-- 2/3. Draft-campaign linkage columns.
alter table d2c_scheduled_sends
  add column if not exists bird_campaign_id text,
  add column if not exists bird_campaign_edit_url text;

comment on column d2c_scheduled_sends.bird_campaign_id is
  'Bird campaign resource id for review-first broadcast job types. Set when a draft_ready campaign is created; NULL for direct-fire and non-Bird sends.';
comment on column d2c_scheduled_sends.bird_campaign_edit_url is
  'Deep link into Bird Studio to review / add audiences / proof-test / fire the draft campaign.';
