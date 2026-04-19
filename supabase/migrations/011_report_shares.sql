-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 — report_shares.
--
-- Slice U: public client-facing event report shares.
--
-- One row per share token. The token is the URL identifier that gets sent to
-- a client; resolving it server-side via the service-role client (bypassing
-- RLS) hands back the underlying event_id + user_id so the public route can
-- load Meta insights using the event owner's stored Facebook token.
--
-- Tokens are 16-char URL-safe strings minted from `crypto.randomBytes(12)`
-- → base64url. Equivalent entropy to `nanoid(16)` — kept dependency-free.
-- (~96 bits — collision-resistant for the operational lifetime of this table.)
--
-- Lifecycle:
--   * `enabled = true`  → share link works (default for fresh rows)
--   * `enabled = false` → share link returns 404, row preserved for audit
--   * `expires_at`      → optional hard cutoff; null = never expires
--
-- view_count + last_viewed_at are bumped from the public route via the
-- service-role client. Best-effort — a failed bump must NOT block report
-- rendering, so the route catches errors and logs them without throwing.
--
-- After applying, regenerate types:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists report_shares (
  token          text        primary key,
  event_id       uuid        not null references events    (id) on delete cascade,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  enabled        boolean     not null default true,
  expires_at     timestamptz,
  view_count     integer     not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists report_shares_event_id_idx on report_shares (event_id);
create index if not exists report_shares_user_id_idx  on report_shares (user_id);

-- ── Row level security ──────────────────────────────────────────────────────
-- Owners can fully manage their own share rows from the dashboard.
-- Public reads via the share route bypass RLS by going through the
-- service-role client — never exposed to the anon key.

alter table report_shares enable row level security;

create policy "owner read"
  on report_shares for select
  using (auth.uid() = user_id);

create policy "owner insert"
  on report_shares for insert
  with check (auth.uid() = user_id);

create policy "owner update"
  on report_shares for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owner delete"
  on report_shares for delete
  using (auth.uid() = user_id);

comment on table  report_shares          is 'Public client-facing share tokens for event reports. Resolved server-side via service-role client.';
comment on column report_shares.token    is 'URL-safe base64url token (16 chars, 96 bits entropy). Primary identifier exposed in /share/report/[token].';
comment on column report_shares.enabled  is 'Soft kill switch — when false the public route returns 404 without deleting the row.';

-- ── PostgREST schema cache refresh ──────────────────────────────────────────

notify pgrst, 'reload schema';
