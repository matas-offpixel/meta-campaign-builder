-- Migration 114: bulk_attach_templates
-- Reusable patterns for the bulk-attach-creatives flow. A template stores
-- the fuzzy match criteria (campaign name / ad set name substrings) and a
-- snapshot of the creative config (copy, CTA, destination URL) so the user
-- can reproduce a similar setup on a future event without re-configuring
-- everything from scratch.
--
-- Design notes:
--   - User-scoped only (v1). Team sharing deferred to backlog.
--   - Templates are NOT event-scoped — they are reusable across events.
--   - client_id is nullable; it's informational/grouping only.
--   - use_count is bumped every time the template is applied (via apply route).
--
-- match_pattern shape:
--   {
--     "campaign_name_contains": ["UTB", "Summer"],
--     "ad_set_name_contains": ["Lookalike", "Remarketing"]
--   }
--   All criteria within a field are OR'd (any match). Fields are independent.
--
-- creative_config shape:
--   {
--     "headline": "...",
--     "description": "...",
--     "cta": "book_now",
--     "destination_url": "https://example.com/{{event_slug}}"
--   }

CREATE TABLE bulk_attach_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       uuid        REFERENCES clients(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  description     text,
  match_pattern   jsonb       NOT NULL DEFAULT '{}',
  creative_config jsonb       NOT NULL DEFAULT '{}',
  use_count       integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-bump updated_at on every write
CREATE OR REPLACE FUNCTION bulk_attach_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bulk_attach_templates_updated_at
  BEFORE UPDATE ON bulk_attach_templates
  FOR EACH ROW EXECUTE FUNCTION bulk_attach_templates_set_updated_at();

-- RLS: each user sees only their own templates
ALTER TABLE bulk_attach_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_bulk_attach_templates"
  ON bulk_attach_templates
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Atomic use_count increment — called from /api/bulk-attach-templates/[id]/apply
CREATE OR REPLACE FUNCTION increment_bulk_attach_template_use_count(
  template_id       uuid,
  template_user_id  uuid
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE bulk_attach_templates
     SET use_count = use_count + 1
   WHERE id = template_id
     AND user_id = template_user_id;
$$;

-- Indexes
CREATE INDEX bulk_attach_templates_user_idx
  ON bulk_attach_templates (user_id, updated_at DESC);

CREATE INDEX bulk_attach_templates_user_client_idx
  ON bulk_attach_templates (user_id, client_id, updated_at DESC);
