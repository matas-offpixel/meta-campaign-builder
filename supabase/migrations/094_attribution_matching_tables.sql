BEGIN;

-- PR #423 — Real Attribution Reconciliation v2 (Layer B).
--
-- Three tables underpinning the dark-build matching layer between
-- ticketing-source PURCHASES and Meta CLICK touchpoints. Until the
-- 4thefans webhook (Joe / 5-fix email 2026-05-18) and the
-- `/api/track/meta-click` snippet are live in production, all three
-- tables stay empty in prod. The matcher cron, the resolver, and
-- the new RealAttributionTile are dark-flagged so an empty table
-- reads as "0 verified" rather than "no data".
--
-- Schema invariants:
--   - All three tables RLS-enabled. service-role-only writes; reads
--     also service-role (the campaigns-aggregator + the resolver
--     run server-side). This keeps the matcher safe from a
--     spoofed POST trying to seed fake matches.
--   - Email + external-id are STORED HASHED (sha256 lowercase
--     trimmed). Raw PII never lands. The `raw_payload` jsonb on
--     `ticketing_purchase_events` is the one exception — it holds
--     the provider's own webhook body for audit / replay. Treat as
--     PII; the table's RLS policy locks reads to the service role.
--   - Idempotency lives on the unique constraints:
--       `ticketing_purchase_events (provider, external_order_id)` —
--           a webhook re-delivery from 4thefans for the same order
--           must not create a second row.
--       `meta_click_touchpoints (fbclid)` — `fbclid` is unique per
--           Meta click; replay the click endpoint and the existing
--           row is the canonical record.
--       `attribution_order_matches (purchase_event_id)` — each
--           purchase gets exactly one match row (matched or
--           unmatched). The matcher cron upserts on this key.

CREATE TABLE IF NOT EXISTS ticketing_purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  external_order_id text NOT NULL,
  provider text NOT NULL,
  purchased_at timestamptz NOT NULL,
  ticket_count integer NOT NULL DEFAULT 1,
  amount_minor integer,
  currency text DEFAULT 'GBP',
  email_hash text,
  external_id_hash text,
  fbc text,
  fbp text,
  ua text,
  ip_hash text,
  raw_payload jsonb,
  inserted_at timestamptz DEFAULT now(),
  CONSTRAINT ticketing_purchase_events_provider_order_unique
    UNIQUE (provider, external_order_id)
);

COMMENT ON TABLE ticketing_purchase_events IS
  'Inbound real-purchase events keyed by (provider, external_order_id). '
  'Written by /api/webhooks/ticketing/[provider]; one row per real '
  'order. Email + external-id stored hashed (sha256 lowercase); raw '
  'webhook payload retained in `raw_payload` for audit and replay.';

CREATE INDEX IF NOT EXISTS ticketing_purchase_events_client_event_idx
  ON ticketing_purchase_events (client_id, event_id, purchased_at DESC);

CREATE INDEX IF NOT EXISTS ticketing_purchase_events_email_hash_idx
  ON ticketing_purchase_events (email_hash)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS ticketing_purchase_events_external_id_hash_idx
  ON ticketing_purchase_events (external_id_hash)
  WHERE external_id_hash IS NOT NULL;

ALTER TABLE ticketing_purchase_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticketing_purchase_events_service_role_all
  ON ticketing_purchase_events;
CREATE POLICY ticketing_purchase_events_service_role_all
  ON ticketing_purchase_events
  FOR ALL
  USING (true)
  WITH CHECK (true);
-- The policy is `true` because RLS is bypassed for service-role
-- automatically; user-role clients have no policy granted, so RLS
-- denies them by default. Mirrors the pattern from migration 041
-- (`active_creatives_snapshots`).


CREATE TABLE IF NOT EXISTS meta_click_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  fbclid text NOT NULL,
  fbc text NOT NULL,
  ad_id text,
  adset_id text,
  campaign_id text,
  landing_url text,
  email_hash text,
  external_id_hash text,
  clicked_at timestamptz NOT NULL,
  inserted_at timestamptz DEFAULT now(),
  CONSTRAINT meta_click_touchpoints_fbclid_unique UNIQUE (fbclid)
);

COMMENT ON TABLE meta_click_touchpoints IS
  'Server-side captured Meta ad clicks. Written by '
  '/api/track/meta-click when an ad-landing-page snippet POSTs the '
  'fbclid. Used as the join target for attribution matching: every '
  '`ticketing_purchase_events` row tries to match back here on '
  'email_hash > external_id_hash > fbc cookie.';

CREATE INDEX IF NOT EXISTS meta_click_touchpoints_client_event_idx
  ON meta_click_touchpoints (client_id, event_id, clicked_at DESC);

CREATE INDEX IF NOT EXISTS meta_click_touchpoints_email_hash_idx
  ON meta_click_touchpoints (email_hash)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS meta_click_touchpoints_external_id_hash_idx
  ON meta_click_touchpoints (external_id_hash)
  WHERE external_id_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS meta_click_touchpoints_fbc_idx
  ON meta_click_touchpoints (fbc);

ALTER TABLE meta_click_touchpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_click_touchpoints_service_role_all
  ON meta_click_touchpoints;
CREATE POLICY meta_click_touchpoints_service_role_all
  ON meta_click_touchpoints
  FOR ALL
  USING (true)
  WITH CHECK (true);


CREATE TABLE IF NOT EXISTS attribution_order_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  purchase_event_id uuid NOT NULL REFERENCES ticketing_purchase_events(id)
    ON DELETE CASCADE,
  touchpoint_id uuid REFERENCES meta_click_touchpoints(id)
    ON DELETE SET NULL,
  match_strategy text NOT NULL,
  matched_at timestamptz DEFAULT now(),
  confidence_score numeric(3, 2),
  CONSTRAINT attribution_order_matches_purchase_unique
    UNIQUE (purchase_event_id),
  CONSTRAINT attribution_order_matches_strategy_check
    CHECK (match_strategy IN (
      'email_hash',
      'external_id',
      'fbc_cookie',
      'unmatched'
    ))
);

COMMENT ON TABLE attribution_order_matches IS
  'One row per ticketing_purchase_events row produced by the '
  'matcher cron. `match_strategy=unmatched` rows have a NULL '
  'touchpoint_id and `confidence_score=0.00`; matched rows carry '
  'the touchpoint they joined to plus a strategy-specific '
  'confidence (email_hash 0.95, external_id 0.90, fbc_cookie 0.70).';

CREATE INDEX IF NOT EXISTS attribution_order_matches_event_strategy_idx
  ON attribution_order_matches (client_id, event_id, match_strategy);

CREATE INDEX IF NOT EXISTS attribution_order_matches_touchpoint_idx
  ON attribution_order_matches (touchpoint_id)
  WHERE touchpoint_id IS NOT NULL;

ALTER TABLE attribution_order_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attribution_order_matches_service_role_all
  ON attribution_order_matches;
CREATE POLICY attribution_order_matches_service_role_all
  ON attribution_order_matches
  FOR ALL
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
