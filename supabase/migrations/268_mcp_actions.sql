-- 268: Off/Pixel MCP v1, M1 (scratch/mcp/mcp-v1-plan.md; Matas's answers 24 Nov).
--
-- The MCP server (/api/mcp) is the app's own OAuth 2.1 authorization server
-- on top of the Supabase login (spec 2025-11-25, no sessions). This migration
-- holds its action log, the per-client spend ceiling M3 reads, and the OAuth
-- store.
--
-- mcp_actions          one row per tool call: tool, args (secrets stripped),
--                      kind, status, result (counts and ids only), error,
--                      duration and result size. M1 writes kind 'read',
--                      status 'done' | 'failed'. M3's request-then-confirm
--                      writes 'requested' with the exact payload, and runs
--                      it only after an approval on Today (approval_source
--                      'today'). The Claude prompt is convenience, never the
--                      record; 'claude_prompt' stays in the CHECK for the
--                      plan's wording and is not written as an approval.
-- client_spend_ceilings  hard daily ceiling per client. Unused until M3; set
--                      by MATAS_USER_IDS only (the app checks, not RLS).
-- mcp_oauth_clients    clients from dynamic registration. redirect_uris are
--                      only the Claude callback or loopback (checked in
--                      lib/mcp/oauth/register.ts, mirrored by the CHECK).
-- mcp_oauth_grants     one consent: user, client, scope, resource. Revoking a
--                      grant kills every token under it.
-- mcp_oauth_codes      authorization codes: SHA-256 only, 5 minutes, one use,
--                      bound to the PKCE challenge, redirect_uri and resource.
-- mcp_oauth_tokens     access (1 h) and refresh (30 d, rotated) tokens:
--                      SHA-256 only. A refresh token used twice revokes its
--                      grant (replaced_by is set on rotation).
--
-- No token, code or secret is ever stored in plaintext or written to
-- mcp_actions. No person data: args and result carry codes, ids and counts.
--
-- Service role only: RLS on, no policy for anon or authenticated. Every read
-- and write is a service-role call from the route handlers.
--
-- Additive. Unapplied: ops applies on prod just before merge, once its
-- sha256 matches the PR head.

create table if not exists public.mcp_oauth_clients (
  client_id      text        primary key check (client_id ~ '^opx_client_[A-Za-z0-9_-]{16,}$'),
  client_name    text        check (char_length(client_name) <= 200),
  redirect_uris  text[]      not null check (cardinality(redirect_uris) between 1 and 5),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);

create table if not exists public.mcp_oauth_grants (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  client_id       text        not null references public.mcp_oauth_clients (client_id) on delete cascade,
  scope           text        not null,
  resource        text        not null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text        check (revoked_reason in ('user', 'refresh_reuse', 'operator_removed', 'script', 'revocation_endpoint'))
);

create index if not exists mcp_oauth_grants_user_idx
  on public.mcp_oauth_grants (user_id)
  where revoked_at is null;

create table if not exists public.mcp_oauth_codes (
  code_hash       text        primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id       text        not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  scope           text        not null,
  resource        text        not null,
  redirect_uri    text        not null,
  code_challenge  text        not null check (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.mcp_oauth_tokens (
  token_hash   text        primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_id     uuid        not null references public.mcp_oauth_grants (id) on delete cascade,
  kind         text        not null check (kind in ('access', 'refresh')),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  replaced_by  text        check (replaced_by ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);

create index if not exists mcp_oauth_tokens_grant_idx
  on public.mcp_oauth_tokens (grant_id);

create table if not exists public.mcp_actions (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  grant_id         uuid        references public.mcp_oauth_grants (id) on delete set null,
  client_id        uuid        references public.clients (id) on delete set null,
  event_id         uuid        references public.events (id) on delete set null,
  tool             text        not null check (tool ~ '^[a-z][a-z0-9_]{0,63}$'),
  args             jsonb       not null default '{}'::jsonb,
  kind             text        not null check (kind in ('read', 'draft', 'meta')),
  status           text        not null check (status in ('requested', 'approved', 'rejected', 'done', 'failed')),
  approved_by      uuid        references auth.users (id) on delete set null,
  approved_at      timestamptz,
  approval_source  text        check (approval_source in ('claude_prompt', 'today')),
  result           jsonb,
  error            text        check (char_length(error) <= 2000),
  duration_ms      integer     check (duration_ms >= 0),
  result_bytes     integer     check (result_bytes >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mcp_actions_approval_complete check (
    (approved_at is null and approved_by is null and approval_source is null)
    or (approved_at is not null and approved_by is not null and approval_source is not null)
  )
);

-- The per-grant rate limit counts a grant's calls over the last minute / hour.
create index if not exists mcp_actions_grant_created_idx
  on public.mcp_actions (grant_id, created_at desc);
create index if not exists mcp_actions_user_created_idx
  on public.mcp_actions (user_id, created_at desc);
-- M3's Today list reads the requested ones.
create index if not exists mcp_actions_requested_idx
  on public.mcp_actions (created_at desc)
  where status = 'requested';

create or replace function public.set_mcp_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mcp_actions_updated_at on public.mcp_actions;
create trigger mcp_actions_updated_at
  before update on public.mcp_actions
  for each row execute function public.set_mcp_actions_updated_at();

create table if not exists public.client_spend_ceilings (
  client_id  uuid        primary key references public.clients (id) on delete cascade,
  daily_gbp  numeric     not null check (daily_gbp >= 0),
  set_by     uuid        not null references auth.users (id),
  set_at     timestamptz not null default now()
);

alter table public.mcp_oauth_clients     enable row level security;
alter table public.mcp_oauth_grants      enable row level security;
alter table public.mcp_oauth_codes       enable row level security;
alter table public.mcp_oauth_tokens      enable row level security;
alter table public.mcp_actions           enable row level security;
alter table public.client_spend_ceilings enable row level security;

revoke all on public.mcp_oauth_clients     from anon, authenticated;
revoke all on public.mcp_oauth_grants      from anon, authenticated;
revoke all on public.mcp_oauth_codes       from anon, authenticated;
revoke all on public.mcp_oauth_tokens      from anon, authenticated;
revoke all on public.mcp_actions           from anon, authenticated;
revoke all on public.client_spend_ceilings from anon, authenticated;

comment on table public.mcp_actions is
  'MCP tool calls (268). Service role only. args secrets-stripped; result counts and ids only. M3: requested -> approved on Today (approval_source today) -> done | failed.';
comment on table public.client_spend_ceilings is
  'Hard per-client daily spend ceiling in GBP (268). Unused until M3. Set by MATAS_USER_IDS only.';
comment on table public.mcp_oauth_tokens is
  'MCP OAuth tokens (268), SHA-256 of the opaque token only. Access 1 h, refresh 30 d rotated; refresh reuse revokes the grant.';
