-- 277_bm_tables_operator_read.sql
--
-- The Business Manager tables stop being readable by /admin client logins
-- (Matas, 27 Nov: "client_business_managers, bm_pages and
-- client_business_manager_links are readable by any authenticated user
-- (policy using (true)), which includes /admin client logins. Restrict SELECT
-- to operators … or service role only").
--
-- The test is 251's: the database can't read the app's operator list
-- (OPERATOR_USER_IDS / isOperator are in code), so a session that belongs to
-- a client_users member (public.is_client_member(), migration 251) is the
-- one shut out. Each open `using (true)` SELECT policy becomes
-- `using (not public.is_client_member())`: operators' sessions keep reading
-- (neither operator account is a client_users member: read on prod, 27 Nov,
-- 1 member, 0 operators), /admin logins read nothing, anon has no policy,
-- and the service role bypasses RLS as before. No user id is written here.
--
-- Why not service role only: six readers use the operator's session today
-- (the launch checks' identity ownership in the launch route, the review
-- step, the live-identity read and the plan mirror; the /business-managers
-- page and API reads; the audience seed remediation; replicate's names; the
-- audience templates action). Service role only would make the launch
-- route skip its identity check silently. This keeps every one working
-- unchanged. lib/bm/__tests__/bm-tables-operator-read.test.ts pins these
-- policies and fails if a client-facing surface (/admin, the portal, share
-- and landing pages) starts reading these tables.
--
-- All seven BM tables had the same open read (pg_policies on prod, 27 Nov):
-- the three named and their siblings bm_ig_accounts, bm_ad_accounts,
-- bm_pixels (147) and bm_page_access_events (145). All seven change.
--
-- Additive in effect: no table, column, grant or data change; only the
-- SELECT policies' test.

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('client_business_managers',      'authenticated read business managers'),
      ('client_business_manager_links', 'authenticated read business manager links'),
      ('bm_pages',                      'authenticated read bm pages'),
      ('bm_page_access_events',         'authenticated read bm page access events'),
      ('bm_ig_accounts',                'authenticated read bm_ig_accounts'),
      ('bm_ad_accounts',                'authenticated read bm_ad_accounts'),
      ('bm_pixels',                     'authenticated read bm_pixels')
    ) as v(tbl, old_policy)
  loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice '277: % is missing, skipped', t.tbl;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.old_policy, t.tbl);
    execute format('drop policy if exists %I on public.%I', 'operators read ' || t.tbl, t.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (not public.is_client_member())',
      'operators read ' || t.tbl,
      t.tbl
    );
  end loop;
end $$;
