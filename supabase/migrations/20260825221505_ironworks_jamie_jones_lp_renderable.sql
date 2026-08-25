-- Repair the B.1 wizard quick-create 404 for Ironworks / Jamie Jones.
--
-- Quick-create inserted page_events.status = 'draft'. The public /l
-- renderer does not serve drafts (resolveLandingPageOutcome). Ironworks
-- also had no client_landing_pages row. This PR's wizard path now creates
-- both; this migration repairs the page already offered as a destination.
--
-- Pixel / CAPI stay unset (LP no-fallback rule). Theme is '{}'::jsonb —
-- the renderer falls through to DEFAULT_LANDING_THEME.
--
-- Guarded on event id AND client/event slugs so a copied-id mistake
-- cannot publish the wrong page. Idempotent.

insert into client_landing_pages (client_id, theme, default_provider)
select e.client_id, '{}'::jsonb, 'internal'
from events e
join clients c on c.id = e.client_id
where e.id = '2d5a5485-bfec-4812-9fcc-2f6f89262f6c'
  and c.slug = 'ironworks'
  and e.slug = 'ironworks-jamie-jones'
  and not exists (
    select 1 from client_landing_pages clp where clp.client_id = e.client_id
  );

update page_events pe
set status = 'live'
from events e
join clients c on c.id = e.client_id
where pe.event_id = e.id
  and e.id = '2d5a5485-bfec-4812-9fcc-2f6f89262f6c'
  and c.slug = 'ironworks'
  and e.slug = 'ironworks-jamie-jones'
  and pe.status = 'draft'
  and pe.provider = 'internal';
