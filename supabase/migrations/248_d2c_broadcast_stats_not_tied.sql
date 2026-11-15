-- Migration 248 — d2c_broadcast_stats.attribution gains 'not_tied' (HE3)
--
-- HE3's attribution now needs a positive match for every state
-- (lib/d2c/stats-ingest/attribution.ts):
--   show          every audience the send targets is one show's list
--   client        the client's whole list or a master tag ("Whole list")
--   not_tied      the client's own send that is neither: one-off lists,
--                 a mix of shows, a widening condition. It counts in the
--                 client's channel totals and in no show ("Not tied to a
--                 show").
--   unattributed  no single client owns the account
--
-- Widens the CHECK only; no column, no row change. The column comment is
-- rewritten to match. Apply by hand from main. Idempotent.

alter table d2c_broadcast_stats
  drop constraint if exists d2c_broadcast_stats_attribution_check;

alter table d2c_broadcast_stats
  add constraint d2c_broadcast_stats_attribution_check
  check (attribution in ('show', 'client', 'not_tied', 'unattributed'));

comment on column d2c_broadcast_stats.attribution is
  'show: every audience the send targets is one show''s CQ-{slug} list (or its opt-in tiers), tag or event code. client: the client''s whole list or a master tag. not_tied: the client''s own send that is neither; in the client''s totals and no show. unattributed: no single client owns the account.';
