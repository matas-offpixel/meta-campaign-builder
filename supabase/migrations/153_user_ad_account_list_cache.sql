-- Migration 153 — user_ad_account_list_cache
--
-- Last-known-good cache for the wizard Step-1 `/api/meta/ad-accounts` list.
--
-- Follow-up to PR #784: Meta charges GET /me/adaccounts against member
-- accounts' ads_management budgets, so one starved dormant account
-- (meta_code=17 on act_932846012721428) bricks the WHOLE list — even with
-- cheap base fields and no expansions. Every Step-1 reload re-charges it
-- and the route 502s.
--
-- When the live list succeeds we upsert here (service-role). When the live
-- list fails rate-limited we serve this row with `stale: true` instead of
-- emptying the picker.
--
-- Access: RLS enabled, NO policies for anon/authenticated. Reads and writes
-- go through the service-role client only (bypasses RLS). Deliberately no
-- owner SELECT policy — this is an ops fallback, not a client-readable
-- surface.

create table if not exists user_ad_account_list_cache (
  user_id uuid primary key references auth.users (id) on delete cascade,
  accounts jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table user_ad_account_list_cache is
  'Last-known-good Meta ad-account list per operator user. Written on successful /api/meta/ad-accounts fetches; served with stale:true when the live /me/adaccounts edge is rate-limited (meta_code=17). Service-role only — migration 153.';

alter table user_ad_account_list_cache enable row level security;

-- Intentionally no CREATE POLICY: authenticated/anon get zero access.
-- Service role bypasses RLS for the route helper.

notify pgrst, 'reload schema';
