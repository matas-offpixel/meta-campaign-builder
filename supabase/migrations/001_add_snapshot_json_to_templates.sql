-- Add the snapshot_json column to campaign_templates if it doesn't exist.
-- This column stores the full campaign snapshot as JSONB.
--
-- Run this in Supabase SQL Editor if you see the error:
--   "Could not find the 'snapshot_json' column of 'campaign_templates' in the schema cache"
--
-- After running, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';

-- If the campaign_templates table doesn't exist at all, create it
CREATE TABLE IF NOT EXISTS campaign_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text        NOT NULL DEFAULT '',
  tags          text[]      NOT NULL DEFAULT '{}',
  snapshot_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- If the table exists but is missing the column, add it
ALTER TABLE campaign_templates
  ADD COLUMN IF NOT EXISTS snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ensure RLS is enabled
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;

-- Create or replace the RLS policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'campaign_templates'
    AND policyname = 'Users can manage their own templates'
  ) THEN
    CREATE POLICY "Users can manage their own templates"
      ON campaign_templates
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
