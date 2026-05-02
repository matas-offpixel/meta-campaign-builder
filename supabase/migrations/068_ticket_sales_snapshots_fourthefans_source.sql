-- Allow native 4thefans API snapshots to carry their own provenance.

alter table ticket_sales_snapshots
  drop constraint if exists ticket_sales_snapshots_source_check;

alter table ticket_sales_snapshots
  add constraint ticket_sales_snapshots_source_check
  check (
    source in (
      'eventbrite',
      'fourthefans',
      'manual',
      'xlsx_import',
      'foursomething'
    )
  );

comment on column ticket_sales_snapshots.source is
  'Provenance of this snapshot row. eventbrite = Eventbrite API. fourthefans = native 4thefans booking API. manual = operator-entered cumulative tickets. xlsx_import = weekly catch-up from an operator upload. foursomething = legacy/internal 4theFans source. NEVER mutated after insert.';

notify pgrst, 'reload schema';
