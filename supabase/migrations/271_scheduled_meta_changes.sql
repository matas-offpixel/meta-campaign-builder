-- 271: Off/Pixel MCP M3b, live changes from the connector.
--
-- 1. scheduled_meta_changes: a budget change Matas said yes to in Claude for
--    a later time (set_budget with `at`). One row per ask, with the chat yes
--    it was asked on. /api/cron/mcp-scheduled-changes (every 15 minutes, only
--    while ENABLE_MCP = "1") applies a due row once, through the same budget
--    write as set_budget now, after re-reading the object: a row whose budget
--    changed since it was asked (expected_minor), or whose object was paused
--    or ended, is skipped and its reason kept in `outcome`, never forced. A
--    spend-raising row re-checks the client's ceiling when it applies.
--    The cron claims a row by moving it scheduled → applying in one guarded
--    UPDATE, so two runs can't both apply it; the write itself is on
--    meta_write_idempotency keyed on the row.
--    Service role only, RLS on with no policy, like 268.
--
-- 2. Five op kinds on meta_write_idempotency for the connector's live writes:
--    campaign_status_update (pause / resume on a campaign),
--    adset_budget_update and campaign_budget_update (set_budget),
--    object_name_update (rename), ad_study_create (create_split_test).
--    The CHECK is dropped by name and re-added with the 22 kinds live on prod
--    (as 267 re-added them) plus these five.
--    Ordering: #1321's 259 re-adds the same CHECK with the 22 kinds only. If
--    259 is applied after 271 it drops these five, so apply 259 first, or
--    give 259 these five too.
--
-- Additive. Not applied from this branch: ops applies from the PR head.

create table if not exists public.scheduled_meta_changes (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  event_id         uuid        references public.events (id) on delete set null,
  client_id        uuid        references public.clients (id) on delete set null,
  kind             text        not null default 'set_budget' check (kind in ('set_budget')),
  object_kind      text        not null check (object_kind in ('campaign', 'adset')),
  object_id        text        not null check (object_id ~ '^[0-9]{5,32}$'),
  object_name      text,
  field            text        not null check (field in ('daily_budget', 'lifetime_budget')),
  amount_minor     bigint      not null check (amount_minor > 0),
  -- Meta's budget on the object when the change was asked; a different one at apply time skips it.
  expected_minor   bigint,
  currency         text        not null default 'GBP',
  raises_spend     boolean     not null,
  run_at           timestamptz not null,
  -- The published draft the write ledger keys this object's writes on.
  ledger_draft_id  uuid        not null references public.campaign_drafts (id) on delete cascade,
  call_key         text        not null,
  approval_asked   text        not null check (char_length(approval_asked) between 1 and 1000),
  approval_answer  text        not null check (char_length(approval_answer) between 1 and 1000),
  approval_source  text        not null default 'claude_prompt' check (approval_source in ('claude_prompt')),
  status           text        not null default 'scheduled' check (status in ('scheduled', 'applying', 'applied', 'skipped', 'cancelled', 'failed')),
  -- Counts, ids and a reason key only (budget_changed, paused, ended, ceiling, switch, unread, meta_failed).
  outcome          jsonb       not null default '{}'::jsonb,
  applied_at       timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scheduled_meta_changes_call_unique unique (user_id, call_key)
);

-- The cron's read: due rows still scheduled.
create index if not exists scheduled_meta_changes_due_idx
  on public.scheduled_meta_changes (run_at)
  where status = 'scheduled';
-- list_scheduled's read.
create index if not exists scheduled_meta_changes_event_idx
  on public.scheduled_meta_changes (event_id, run_at desc);

create or replace function public.set_scheduled_meta_changes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists scheduled_meta_changes_updated_at on public.scheduled_meta_changes;
create trigger scheduled_meta_changes_updated_at
  before update on public.scheduled_meta_changes
  for each row execute function public.set_scheduled_meta_changes_updated_at();

alter table public.scheduled_meta_changes enable row level security;
revoke all on public.scheduled_meta_changes from anon, authenticated;

comment on table public.scheduled_meta_changes is
  'Budget changes asked through the Off/Pixel connector for a later time (271). Service role only. Applied once by /api/cron/mcp-scheduled-changes; skipped, never forced, when the object changed since.';

alter table public.meta_write_idempotency
  drop constraint if exists meta_write_idempotency_op_kind_check;

alter table public.meta_write_idempotency
  add constraint meta_write_idempotency_op_kind_check
  check (op_kind in (
    'campaign_create',
    'adset_create',
    'ad_create',
    'creative_upload',
    'adset_targeting_update',
    'adset_destination_update',
    'refresh_creative_create',
    'refresh_ad_create',
    'ad_status_update',
    'adset_status_update',
    'refresh_adset_budget_update',
    'refresh_adset_create',
    'refresh_custom_conversion_create',
    'refresh_campaign_create',
    'refresh_campaign_lifetime_budget_update',
    'refresh_campaign_status_update',
    'retargeting_audience_rule_update',
    'retargeting_study_create',
    'retargeting_study_end',
    'adset_end_time_update',
    'customer_list_create',
    'customer_list_users',
    'campaign_status_update',
    'adset_budget_update',
    'campaign_budget_update',
    'object_name_update',
    'ad_study_create'
  ));
