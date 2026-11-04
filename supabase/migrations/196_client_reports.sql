-- 196 — client season reports.
--
-- A static HTML report for one client and season, served at
-- /share/season/{share_token} with no login. The token is its own
-- credential. It is not a report_shares row and not a new scope on
-- that table: a client portal token (can_edit = true, ticket input)
-- must not open a report, and a report token must not open the portal.
--
-- Unapplied. Matas applies this after review.
--
-- Storage is a private bucket. There is deliberately no
-- storage.objects policy: anon and authenticated cannot read or write
-- the HTML. The service role bypasses storage RLS. The operator API
-- checks the session and client ownership, then uploads. The public
-- route downloads and returns the bytes. No signed URL.

create table if not exists client_reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  season        text not null,
  title         text not null,
  -- {client_id}/{season}/{id}.html inside the client-reports bucket.
  storage_path  text not null,
  share_token   text not null,
  enabled       boolean not null default true,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint client_reports_share_token_key unique (share_token),
  constraint client_reports_season_chk check (
    char_length(btrim(season)) between 1 and 64
  ),
  constraint client_reports_title_chk check (
    char_length(btrim(title)) between 1 and 120
  ),
  -- 16-char base64url, the same shape as generateShareToken.
  constraint client_reports_share_token_format check (
    share_token ~ '^[A-Za-z0-9_-]{16}$'
  ),
  -- The path is pinned to this row's client. An owner update cannot
  -- retarget the row at another client's object.
  constraint client_reports_storage_path_chk check (
    storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}/[0-9a-f-]{36}\.html$'
    and storage_path like (client_id::text || '/%')
    and storage_path not like '%..%'
  )
);

comment on table client_reports is
  'One self-contained HTML season report per row. Public read is the service-role route /share/season/{share_token}. Owner CRUD is RLS through clients.user_id. Not a report_shares scope. Migration 196.';

create index if not exists client_reports_client_idx
  on client_reports (client_id, created_at desc);

alter table client_reports enable row level security;

-- Owner of the client may read and write. Another user, and anon,
-- match no row. Service role bypasses RLS for the public route.
drop policy if exists "Owners manage client reports" on client_reports;
create policy "Owners manage client reports"
  on client_reports
  for all
  using (
    exists (
      select 1 from clients c
      where c.id = client_reports.client_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from clients c
      where c.id = client_reports.client_id
        and c.user_id = auth.uid()
    )
  );

drop trigger if exists client_reports_updated_at on client_reports;
create trigger client_reports_updated_at
  before update on client_reports
  for each row execute procedure update_updated_at_column();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-reports',
  'client-reports',
  false,
  4718592,
  array['text/html']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
