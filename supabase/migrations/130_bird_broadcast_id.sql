-- 130_bird_broadcast_id.sql
--
-- Bird broadcast pivot follow-up (PR: d2c/bird-broadcast-drafts).
--
-- The DevTools capture (.scratch/bird-campaign-draft-capture.txt) confirmed
-- Bird's create flow is a nested three-call sequence:
--   POST  /campaigns                        → campaign envelope (bird_campaign_id, migration 129)
--   POST  /campaigns/{cid}/broadcasts        → broadcast child   (bird_broadcast_id, THIS migration)
--   PATCH /campaigns/{cid}/broadcasts/{bid}  → full config
--
-- We persist BOTH ids so review + later reporting can address the broadcast
-- child directly (e.g. GET …/broadcasts/{bid}?expand=counters_subscribed).
--
-- Reversibility:
--   alter table d2c_scheduled_sends drop column if exists bird_broadcast_id;
-- ─────────────────────────────────────────────────────────────────────────────

alter table d2c_scheduled_sends
  add column if not exists bird_broadcast_id text;

comment on column d2c_scheduled_sends.bird_broadcast_id is
  'Bird broadcast child resource id (nested under bird_campaign_id). Set when a draft_ready campaign is created; NULL for direct-fire and non-Bird sends.';
