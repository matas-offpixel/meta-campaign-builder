-- Migration 113: bulk_attach_drafts
-- Persists wizard state for the bulk-attach-creatives flow so operators can
-- save mid-session and resume from any browser without re-doing campaign /
-- ad-set picking.
--
-- Scope:
--   - Per-user only (v1). Team sharing deferred to backlog.
--   - RLS: each row is readable/writable only by the user who created it.
--   - state (jsonb) stores the full serialised BulkAttachDraftState shape.
--   - client_id is nullable: populated when the event has a linked client,
--     left NULL for unlinked events.
--   - event_id is nullable to allow event-agnostic drafts in future.

CREATE TABLE bulk_attach_drafts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id      uuid        REFERENCES events(id) ON DELETE SET NULL,
  client_id     uuid        REFERENCES clients(id) ON DELETE SET NULL,
  name          text        NOT NULL DEFAULT 'Untitled draft',
  state         jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-bump updated_at on every write
CREATE OR REPLACE FUNCTION bulk_attach_drafts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bulk_attach_drafts_updated_at
  BEFORE UPDATE ON bulk_attach_drafts
  FOR EACH ROW EXECUTE FUNCTION bulk_attach_drafts_set_updated_at();

-- RLS: each user sees only their own drafts
ALTER TABLE bulk_attach_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_bulk_attach_drafts"
  ON bulk_attach_drafts
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indexes
CREATE INDEX bulk_attach_drafts_user_event_idx
  ON bulk_attach_drafts (user_id, event_id, updated_at DESC);

CREATE INDEX bulk_attach_drafts_user_idx
  ON bulk_attach_drafts (user_id, updated_at DESC);
