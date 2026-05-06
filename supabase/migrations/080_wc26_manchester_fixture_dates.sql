-- WC26 Depot Mayfield (Manchester): set real per-fixture dates on every shell row.
-- Venue dashboard grouping no longer requires a shared placeholder event_date.
-- Idempotent UPDATEs for 4theFans client only.

begin;

update public.events e
set
  event_date = v.d::date,
  event_start_at = v.ts::timestamptz
from (
  values
    ('wc26-manchester-croatia', '2026-06-17', timestamptz '2026-06-17 21:00:00+01'),
    ('wc26-manchester-panama', '2026-06-27', timestamptz '2026-06-27 22:00:00+01'),
    ('wc26-manchester-last32', '2026-07-01', null::timestamptz)
) as v(slug, d, ts)
where e.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
  and e.event_code = 'WC26-MANCHESTER'
  and e.slug = v.slug;

-- Ghana template row (slug varies); match by fixture title.
update public.events
set
  event_date = date '2026-06-23',
  event_start_at = timestamptz '2026-06-23 20:00:00+01'
where client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
  and event_code = 'WC26-MANCHESTER'
  and name ilike '%Ghana%'
  and id not in (
    select e2.id
    from public.events e2
    where e2.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
      and e2.event_code = 'WC26-MANCHESTER'
      and e2.slug in (
        'wc26-manchester-croatia',
        'wc26-manchester-panama',
        'wc26-manchester-last32'
      )
  );

commit;
