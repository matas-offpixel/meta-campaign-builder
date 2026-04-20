-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027 — events.kind discriminator + brand campaign columns.
--
-- Until now every row in `events` was a dated show with a venue, ticket cap,
-- and presale phases. Brand awareness / video-view campaigns don't fit that
-- mould — they have a date *range* instead of a single moment, no venue, and
-- no ticket sales. We model both engagement types in the same table behind a
-- discriminator (`kind`) so dashboards, sharing, invoicing, and the TikTok
-- import pipeline keep working uniformly.
--
-- New columns:
--   kind             text, default 'event'  — discriminator
--   objective        text                   — required when kind='brand_campaign'
--   campaign_end_at  timestamptz            — end of the brand campaign window
--                                            (event_start_at = the start)
--
-- Backfill: the default + check constraint mean every existing row becomes
-- kind='event' with no further work needed.
--
-- After applying:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists kind text not null default 'event'
    check (kind in ('event', 'brand_campaign')),
  add column if not exists objective text,
  add column if not exists campaign_end_at timestamptz;

create index if not exists events_kind_idx on events (kind);

comment on column events.kind is
  'Engagement type. "event" = dated show (default). "brand_campaign" = date-ranged brand/awareness push (no venue, no ticket cap, no presale phase).';
comment on column events.objective is
  'Marketing objective. Required for kind=brand_campaign ("Reach" | "Brand Awareness" | "Video View" | "Conversions"). Null for kind=event.';
comment on column events.campaign_end_at is
  'End of the brand campaign window. Null for kind=event (which use event_start_at as the single moment).';

-- ── Cross-column constraint ───────────────────────────────────────────────
-- A brand campaign without a stated objective is meaningless — enforce it
-- at the DB layer so the dashboard form doesn't have to be the only guard.
-- Wrapped in a do-block so the migration is idempotent.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_brand_campaign_requires_objective'
  ) then
    alter table events
      add constraint events_brand_campaign_requires_objective
        check (kind <> 'brand_campaign' or objective is not null);
  end if;
end$$;

notify pgrst, 'reload schema';
