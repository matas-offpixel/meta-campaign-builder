alter table events
add column if not exists preferred_provider text
check (
  preferred_provider in ('fourthefans', 'eventbrite', 'manual', 'tiktok')
  or preferred_provider is null
);

create index if not exists events_preferred_provider_idx
  on events(preferred_provider);

notify pgrst, 'reload schema';
