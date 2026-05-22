-- Migration 097: add structure_mode to google_search_plans
--
-- Adds the campaign-structure mode flag introduced in the single-campaign
-- PR. Two modes:
--
--   campaign_per_theme  — current behaviour: one campaign per C-code, each
--                         with its own budget.  Used by multi-event or
--                         "separate budget control" plans.
--   single_campaign     — NEW DEFAULT: all C-codes collapse into ad groups
--                         under one campaign. Cheaper to manage for single
--                         events; one budget flows to the best-performing
--                         themes.
--
-- DEFAULT 'single_campaign' so new plans and existing plans (NULL-coerced
-- via the NOT NULL + DEFAULT) both get the new behaviour. Existing
-- already-imported plans are typically single-event J2-style imports and
-- are fine with the new default.
--
-- No backfill needed: the column has a server-side DEFAULT so Supabase's
-- existing rows pick it up without an UPDATE.
--
-- Apply via Supabase MCP after PR review.

alter table google_search_plans
  add column if not exists structure_mode text not null default 'single_campaign'
    check (structure_mode in ('campaign_per_theme', 'single_campaign'));

comment on column google_search_plans.structure_mode is
  'How C-codes are mapped at import time. campaign_per_theme = one campaign per C-code (original behaviour); single_campaign = all C-codes as ad groups under one campaign (new default, recommended for single events).';
