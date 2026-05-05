-- Migration 075 - running-total semantics for additional_ticket_entries.
--
-- Each row is the latest external-sales snapshot for one natural source:
-- (event_id, scope, tier_name, source, label). Before adding the unique
-- expression index, collapse any duplicate historical rows by keeping the
-- most recently updated snapshot.

with ranked as (
  select
    id,
    row_number() over (
      partition by
        event_id,
        scope,
        coalesce(tier_name, ''),
        coalesce(source, ''),
        label
      order by
        coalesce(updated_at, created_at) desc,
        created_at desc,
        id desc
    ) as rn
  from public.additional_ticket_entries
)
delete from public.additional_ticket_entries
where id in (
  select id
  from ranked
  where rn > 1
);

create unique index if not exists additional_ticket_entries_natural_key_idx
  on public.additional_ticket_entries (
    event_id,
    scope,
    coalesce(tier_name, ''),
    coalesce(source, ''),
    label
  );

comment on index public.additional_ticket_entries_natural_key_idx is
  'Enforces one running-total snapshot per event/scope/tier/source/label tuple.';

notify pgrst, 'reload schema';
