BEGIN;

-- Flatten KOC fixture-level event_codes to venue-level 3-part prefix.
-- WC26-KOC-BRIXTON-ENG-CRO  →  WC26-KOC-BRIXTON
-- WC26-KOC-HACKNEY-FRA-SEN  →  WC26-KOC-HACKNEY
-- WC26-KOC-SOHO-SCO-BRA     →  WC26-KOC-SOHO
--
-- This aligns KOC with the 4theFans pattern: all fixtures at a venue share
-- the same event_code; fixture identity lives in events.name + event_date.
-- The allocator, active-creatives bracket join, and dashboard grouping all
-- work without client-specific branches once the code matches the campaign
-- bracket ([WC26-KOC-BRIXTON]) that Meta campaigns are already tagged with.
--
-- Idempotent: WHERE filters on >3 parts, so 3-part codes are a no-op.
UPDATE events
SET event_code = 'WC26-KOC-' || SPLIT_PART(event_code, '-', 3)
WHERE event_code ILIKE 'WC26-KOC-%'
  AND ARRAY_LENGTH(STRING_TO_ARRAY(event_code, '-'), 1) > 3;

NOTIFY pgrst, 'reload schema';

COMMIT;
