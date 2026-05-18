BEGIN;

-- PR #422 — Attribution gap classifier + internal campaigns tab.
--
-- Read-side helper view + index for the per-event attribution
-- snapshot the dashboard renders on the venue Performance tab and
-- the events table Attribution column.
--
-- The view is **read-only**. Every write path (rollup-sync runner,
-- tier-channel sales, etc.) is unchanged — the broken `meta_regs`
-- value is exposed as-is so the surface can label the over-
-- attribution as a state rather than silently dedup it.
--
-- Reads happen through `lib/dashboard/canonical-event-metrics.ts`'s
-- `computeCanonicalEventMetrics(...)`. This view is a convenience
-- snapshot for ad-hoc SQL inspection (and a candidate cache target
-- for a future cron) — the dashboard never reads from it directly
-- in this PR.

CREATE OR REPLACE VIEW v_event_code_attribution_snapshot AS
WITH rollup_tickets AS (
  SELECT
    e.client_id,
    e.event_code,
    SUM(COALESCE(r.tickets_sold, 0))::bigint AS tickets_rollup_sum
  FROM events e
  LEFT JOIN event_daily_rollups r ON r.event_id = e.id
  WHERE e.event_code IS NOT NULL
  GROUP BY e.client_id, e.event_code
),
tier_channel_tickets AS (
  SELECT
    e.client_id,
    e.event_code,
    SUM(COALESCE(s.tickets_sold, 0))::bigint AS tickets_tier_channel_sum
  FROM events e
  JOIN event_ticket_tiers ett ON ett.event_id = e.id
  LEFT JOIN tier_channel_sales s ON s.tier_id = ett.id
  WHERE e.event_code IS NOT NULL
  GROUP BY e.client_id, e.event_code
)
SELECT
  c.client_id,
  c.event_code,
  COALESCE(c.meta_regs, 0)::bigint                                     AS meta_regs,
  COALESCE(rt.tickets_rollup_sum, 0)::bigint                            AS tickets_rollup_sum,
  COALESCE(tc.tickets_tier_channel_sum, 0)::bigint                      AS tickets_tier_channel_sum,
  GREATEST(
    COALESCE(rt.tickets_rollup_sum, 0),
    COALESCE(tc.tickets_tier_channel_sum, 0)
  )::bigint                                                            AS tickets_true,
  CASE
    WHEN COALESCE(c.meta_regs, 0) = 0
      AND GREATEST(
        COALESCE(rt.tickets_rollup_sum, 0),
        COALESCE(tc.tickets_tier_channel_sum, 0)
      ) = 0 THEN 'no_data'
    WHEN COALESCE(c.meta_regs, 0) = 0
      AND GREATEST(
        COALESCE(rt.tickets_rollup_sum, 0),
        COALESCE(tc.tickets_tier_channel_sum, 0)
      ) > 0 THEN 'capi_missing'
    WHEN COALESCE(c.meta_regs, 0) > GREATEST(
        COALESCE(rt.tickets_rollup_sum, 0),
        COALESCE(tc.tickets_tier_channel_sum, 0)
      ) THEN 'over_attributed'
    ELSE 'tracked'
  END                                                                  AS attribution_state,
  CASE
    WHEN GREATEST(
      COALESCE(rt.tickets_rollup_sum, 0),
      COALESCE(tc.tickets_tier_channel_sum, 0)
    ) > 0
     AND COALESCE(c.meta_regs, 0) <= GREATEST(
       COALESCE(rt.tickets_rollup_sum, 0),
       COALESCE(tc.tickets_tier_channel_sum, 0)
     )
    THEN COALESCE(c.meta_regs, 0)::numeric / NULLIF(GREATEST(
      COALESCE(rt.tickets_rollup_sum, 0),
      COALESCE(tc.tickets_tier_channel_sum, 0)
    ), 0)
    ELSE NULL
  END                                                                  AS attribution_rate,
  c.fetched_at                                                          AS cache_fetched_at
FROM event_code_lifetime_meta_cache c
LEFT JOIN rollup_tickets rt
  ON rt.client_id = c.client_id AND rt.event_code = c.event_code
LEFT JOIN tier_channel_tickets tc
  ON tc.client_id = c.client_id AND tc.event_code = c.event_code;

COMMENT ON VIEW v_event_code_attribution_snapshot IS
  'Read-only convenience view per (client_id, event_code) joining '
  'event_code_lifetime_meta_cache.meta_regs against the canonical '
  'tickets_true (MAX of rollup sum + tier_channel_sales sum) to '
  'precompute the four-state attribution classifier (no_data, '
  'capi_missing, over_attributed, tracked) used by the venue '
  'Performance tile and the campaigns tab attribution badge. '
  'The dashboard reads via computeCanonicalEventMetrics — this '
  'view is for ad-hoc SQL inspection + a future cache cron target.';

-- Note on indexing: `event_code_lifetime_meta_cache` already has a
-- composite primary key on `(client_id, event_code)` (migration 068),
-- which Postgres backs with a unique B-tree index. That index covers
-- every read pattern the dashboard performs (loadEventCodeLifetimeMetaCacheForClient
-- + loadEventCodeLifetimeMetaCache both filter on the leading column
-- `client_id` first, then optionally `event_code`). Adding a second
-- non-unique index would just duplicate the PK without changing query
-- plans, so this migration intentionally ships no extra index.

NOTIFY pgrst, 'reload schema';

COMMIT;
