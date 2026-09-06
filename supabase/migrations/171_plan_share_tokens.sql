-- Migration 171 — plan_share_tokens
--
-- Canon §1.6 share link. The plan id is not a credential. Tokens are
-- 16-char base64url (same as report_shares), resolved via the service-role
-- client. enabled + revoke; can_edit is fixed false. Unknown / disabled
-- tokens 404 with the same generic page. No internal ids in the URL.
--
-- Independent of 169 / 170. Apply with this PR.

create table if not exists plan_share_tokens (
  token      text        primary key,
  plan_id    uuid        not null references campaign_plans (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  enabled    boolean     not null default true,
  can_edit   boolean     not null default false,
  created_at timestamptz not null default now(),
  constraint plan_share_tokens_can_edit_false check (can_edit = false)
);

create unique index if not exists plan_share_tokens_plan_id_uidx
  on plan_share_tokens (plan_id);
create index if not exists plan_share_tokens_user_id_idx
  on plan_share_tokens (user_id);

alter table plan_share_tokens enable row level security;

create policy "owner read"
  on plan_share_tokens for select
  using (auth.uid() = user_id);

create policy "owner insert"
  on plan_share_tokens for insert
  with check (auth.uid() = user_id);

create policy "owner update"
  on plan_share_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owner delete"
  on plan_share_tokens for delete
  using (auth.uid() = user_id);

comment on table  plan_share_tokens         is 'Public client-facing share tokens for one campaign plan. Resolved server-side via service-role; the token is the only identifier in /share/plan/[token].';
comment on column plan_share_tokens.token   is 'URL-safe base64url token (16 chars, 96 bits). Primary identifier exposed in the share URL.';
comment on column plan_share_tokens.enabled is 'Soft revoke — when false the public route returns 404 without deleting the row.';
comment on column plan_share_tokens.can_edit is 'Always false. Share is view-only (role=client).';

notify pgrst, 'reload schema';
