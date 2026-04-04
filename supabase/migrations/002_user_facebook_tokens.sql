-- Stores Facebook OAuth provider_token per authenticated user (for Meta Graph
-- calls that require the user's own Facebook session). RLS: users only see own row.

create table if not exists user_facebook_tokens (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  provider_token  text not null,
  updated_at      timestamptz not null default now()
);

alter table user_facebook_tokens enable row level security;

create policy "Users read own facebook token"
  on user_facebook_tokens
  for select
  using (auth.uid() = user_id);

create policy "Users upsert own facebook token"
  on user_facebook_tokens
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own facebook token"
  on user_facebook_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own facebook token"
  on user_facebook_tokens
  for delete
  using (auth.uid() = user_id);

create trigger user_facebook_tokens_updated_at
  before update on user_facebook_tokens
  for each row execute procedure update_updated_at_column();
