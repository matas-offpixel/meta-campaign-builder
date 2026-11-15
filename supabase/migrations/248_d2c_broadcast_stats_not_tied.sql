-- Migration 248 — d2c_broadcast_stats.attribution gains 'not_tied', and
-- clients.d2c_whole_list_tags (HE3)
--
-- HE3's attribution now needs a positive match for every state
-- (lib/d2c/stats-ingest/attribution.ts):
--   show          every audience the send targets is one show's list
--   client        the client's whole list: no list or segment, a tag in
--                 clients.d2c_whole_list_tags, or its umbrella page's CQ
--                 lists ("Whole list")
--   not_tied      the client's own send that is neither: one-off lists,
--                 a mix of shows, a widening condition. It counts in the
--                 client's channel totals and in no show ("Not tied to a
--                 show").
--   unattributed  no single client owns the account
--
-- Widens the attribution CHECK (the column comment is rewritten to match)
-- and adds clients.d2c_whole_list_tags. No row is changed and nothing is
-- seeded: ops writes each client's tags after applying (Electric Group:
-- '{NX Loves}'). Until then the list is empty and those sends read not
-- tied. Apply by hand from main. Idempotent.

alter table d2c_broadcast_stats
  drop constraint if exists d2c_broadcast_stats_attribution_check;

alter table d2c_broadcast_stats
  add constraint d2c_broadcast_stats_attribution_check
  check (attribution in ('show', 'client', 'not_tied', 'unattributed'));

comment on column d2c_broadcast_stats.attribution is
  'show: every audience the send targets is one show''s CQ-{slug} list (or its opt-in tiers), tag or event code. client: the client''s whole list (no list or segment, a clients.d2c_whole_list_tags tag, or its umbrella page''s CQ lists). not_tied: the client''s own send that is neither; in the client''s totals and no show. unattributed: no single client owns the account.';

alter table clients
  add column if not exists d2c_whole_list_tags text[] not null default '{}';

comment on column clients.d2c_whole_list_tags is
  'HE3: Bird list and Mailchimp tag names that are this client''s whole list (master tags, e.g. NX Loves), case-insensitive. A send to only these is "Whole list", never a show. Umbrella pages'' CQ lists count without being listed here. Ops sets it; empty by default.';
