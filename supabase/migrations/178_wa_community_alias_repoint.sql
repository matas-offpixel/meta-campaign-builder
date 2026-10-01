-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 178 — repointable community aliases
--
-- Widens wa_community_aliases.slug so a path segment can be a vanity slug
-- (including the dotted runbook shape Throwback-Porto-17.10.26), or a
-- mixed-case WhatsApp invite code stored as the slug so /j/{code} can be
-- repointed. Adds optional event_ref. Installs the one-transaction repoint
-- and create functions, and a deferred guard so
-- wa_community_aliases.active_invite_code cannot drift from the active
-- wa_community_alias_destinations.invite_code.
--
-- interstitial_enabled defaults false. Cirqlin 302s unless this is true.
-- The card is opt-in per alias (cirqlin #454).
--
-- Authority (Decision 1): wa_community_alias_destinations is the source of
-- truth for the invite code (partial unique uq_wa_community_alias_destinations_one_active
-- plus the audit table). active_invite_code is a denormalised cache written
-- in the same transaction.
--
-- Constraint name read from pg_constraint on project zbtldbfjbhfvpksmdvnt
-- on 2026-09-27, not from a draft:
--   conname: wa_community_aliases_slug_format
--   pg_get_constraintdef: CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
-- There is no wa_community_aliases_slug_check. Dropping that name would
-- succeed and change nothing.
--
-- Survival check on that date: 0 of 14 slugs fail the new shape.
--   azyr-nx, cdw, djez-nx, dod-nx, eed-nx, fever105-sheffield, folamour-nx,
--   gds-sheffield, ipc-nx, mg-sheffield, puzzle-circuit, robbie-nx,
--   rudimental-nx, schak-nx
--
-- Known divergence, not repaired here (no audit events on the row):
--   slug rudimental-nx is inactive and active_invite_code is null, while its
--   destination row is still is_active. The deferred guard does not scan
--   existing rows. The next write that touches that alias's invite homes
--   fails until they are reconciled. Repoint heals them because it sets both.
--
-- Apply BEFORE the app that calls these functions is deployed.
-- Do not apply on a day with a live D2C send.
--
-- Down-migration (run by hand, inside a transaction, before any mixed-case
-- or dotted slug exists). Restores the predicate copied from
-- pg_get_constraintdef, not a retyped guess:
--
--   drop trigger if exists wa_community_alias_dest_homes_agree on wa_community_alias_destinations;
--   drop trigger if exists wa_community_alias_cache_homes_agree on wa_community_aliases;
--   drop function if exists trg_wa_alias_invite_homes_agree();
--   drop function if exists assert_wa_alias_invite_homes(uuid);
--   drop function if exists repoint_community_alias(text, text, uuid, text);
--   drop function if exists create_community_alias(text, uuid, text, text, text, text, uuid, text);
--   alter table wa_community_aliases drop column if exists interstitial_enabled;
--   alter table wa_community_aliases drop column if exists event_ref;
--   alter table wa_community_aliases drop constraint wa_community_aliases_slug_format;
--   alter table wa_community_aliases add constraint wa_community_aliases_slug_format
--     check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
--
-- Restoring the old CHECK fails if any slug uses uppercase, a dot, or any
-- other character the original predicate rejects. Delete those rows first.
-- ─────────────────────────────────────────────────────────────────────────────

-- Re-read the live constraint at apply time. A wrong name or an unexpected
-- predicate aborts. A second apply that already has the new predicate skips
-- the swap instead of failing.
do $$
declare
  def text;
  n int;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public'
    and t.relname = 'wa_community_aliases'
    and c.conname = 'wa_community_aliases_slug_format';

  if def is null then
    raise exception
      'expected constraint wa_community_aliases_slug_format on wa_community_aliases; refusing to guess another name';
  end if;

  if def like '%^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$%' then
    raise notice 'wa_community_aliases_slug_format already admits the repoint shape; skipping swap';
  elsif def like '%^[a-z0-9]+(-[a-z0-9]+)*$%' then
    select count(*) into n
    from wa_community_aliases
    where slug !~ '^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$';
    if n <> 0 then
      raise exception 'slug survival check failed: % row(s) would be rejected by the new shape', n;
    end if;

    alter table wa_community_aliases drop constraint wa_community_aliases_slug_format;
    alter table wa_community_aliases
      add constraint wa_community_aliases_slug_format
      check (slug ~ '^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$');
  else
    raise exception
      'wa_community_aliases_slug_format has an unexpected definition (%). Read pg_constraint and edit this migration.',
      def;
  end if;
end $$;

alter table wa_community_aliases
  add column if not exists event_ref text;

alter table wa_community_aliases
  add column if not exists interstitial_enabled boolean not null default false;

comment on column wa_community_aliases.slug is
  'Path segment under /j/{slug}. Letters, digits, hyphens, and dots. Case-sensitive. A mixed-case invite code is a valid slug so /j/{code} can be repointed. Migration 178.';
comment on column wa_community_aliases.active_invite_code is
  'Denormalised cache of the active wa_community_alias_destinations.invite_code. Destinations are authoritative. Written only in the same transaction by create_community_alias / repoint_community_alias. Migration 178.';
comment on column wa_community_aliases.event_ref is
  'Optional label for an ephemeral event that does not warrant a clients row. Migration 178.';
comment on column wa_community_aliases.interstitial_enabled is
  'When true, cirqlin renders the group card. When false, crqln.com/j/{slug} 302s straight to WhatsApp. Default false. Migration 178.';

-- ── homes guard ──────────────────────────────────────────────────────────────

create or replace function assert_wa_alias_invite_homes(p_alias_id uuid)
  returns void
  language plpgsql
  set search_path = public
as $$
declare
  v_cache text;
  v_dest text;
begin
  select active_invite_code into v_cache
  from wa_community_aliases
  where id = p_alias_id;

  -- Alias row already gone (cascade delete): nothing left to diverge.
  if not found then
    return;
  end if;

  select invite_code into v_dest
  from wa_community_alias_destinations
  where alias_id = p_alias_id
    and is_active = true
  limit 1;

  if v_dest is distinct from v_cache then
    raise exception 'wa_community_alias_invite_homes_diverged'
      using errcode = '23514',
            detail = format('cache=%s destination=%s', coalesce(v_cache, '<null>'), coalesce(v_dest, '<null>'));
  end if;
end;
$$;

create or replace function trg_wa_alias_invite_homes_agree()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'wa_community_aliases' then
    v_id := coalesce(new.id, old.id);
  else
    v_id := coalesce(new.alias_id, old.alias_id);
  end if;
  perform assert_wa_alias_invite_homes(v_id);
  return null;
end;
$$;

-- Deferred so a transaction may clear the old active destination and write
-- the new one before the check runs. A partial unique index rejects a second
-- active row; it does not deactivate the previous one.
drop trigger if exists wa_community_alias_dest_homes_agree on wa_community_alias_destinations;
create constraint trigger wa_community_alias_dest_homes_agree
  after insert or update or delete on wa_community_alias_destinations
  deferrable initially deferred
  for each row
  execute function trg_wa_alias_invite_homes_agree();

drop trigger if exists wa_community_alias_cache_homes_agree on wa_community_aliases;
create constraint trigger wa_community_alias_cache_homes_agree
  after update of active_invite_code on wa_community_aliases
  deferrable initially deferred
  for each row
  execute function trg_wa_alias_invite_homes_agree();

-- ── create (both homes, one transaction) ─────────────────────────────────────

create or replace function create_community_alias(
  p_slug text,
  p_client_id uuid,
  p_brand text,
  p_notes text,
  p_invite_code text,
  p_label text,
  p_actor uuid,
  p_event_ref text
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_slug text := btrim(p_slug);
  v_code text := btrim(p_invite_code);
begin
  if v_slug !~ '^[A-Za-z0-9]+([-.][A-Za-z0-9]+)*$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if v_code !~ '^[A-Za-z0-9]{8,30}$' then
    raise exception 'invalid_invite_code' using errcode = '22023';
  end if;

  insert into wa_community_aliases (
    slug, client_id, brand, notes, is_active, active_invite_code,
    event_ref, created_by_user_id, updated_by_user_id
  ) values (
    v_slug,
    p_client_id,
    nullif(btrim(coalesce(p_brand, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    true,
    v_code,
    nullif(btrim(coalesce(p_event_ref, '')), ''),
    p_actor,
    p_actor
  )
  returning id into v_id;

  insert into wa_community_alias_destinations (
    alias_id, invite_code, label, sort_order, is_active, activated_at
  ) values (
    v_id,
    v_code,
    coalesce(nullif(btrim(coalesce(p_label, '')), ''), 'Group 1'),
    0,
    true,
    now()
  );

  insert into wa_community_alias_events (alias_id, user_id, action, detail)
  values (
    v_id,
    p_actor,
    'created',
    jsonb_build_object('slug', v_slug, 'invite_code', v_code, 'event_ref', p_event_ref)
  );

  perform assert_wa_alias_invite_homes(v_id);

  return jsonb_build_object('alias_id', v_id, 'slug', v_slug, 'invite_code', v_code);
end;
$$;

-- ── repoint (both homes, one transaction) ────────────────────────────────────
-- The partial unique index does not swap the active row. This function
-- deactivates the previous active destination, then activates or inserts the
-- new code, then updates the cache, then appends the audit row.

create or replace function repoint_community_alias(
  p_slug text,
  p_invite_code text,
  p_actor uuid,
  p_label text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_alias wa_community_aliases%rowtype;
  v_code text := btrim(p_invite_code);
  v_dest_id uuid;
  v_order int;
begin
  if v_code !~ '^[A-Za-z0-9]{8,30}$' then
    raise exception 'invalid_invite_code' using errcode = '22023';
  end if;

  select * into v_alias
  from wa_community_aliases
  where slug = btrim(p_slug)
  for update;

  if not found then
    raise exception 'alias_not_found' using errcode = 'P0002';
  end if;

  update wa_community_alias_destinations
    set is_active = false
    where alias_id = v_alias.id
      and is_active = true
      and invite_code <> v_code;

  update wa_community_alias_destinations
    set is_active = true,
        activated_at = now(),
        label = coalesce(nullif(btrim(coalesce(p_label, '')), ''), label)
    where alias_id = v_alias.id
      and invite_code = v_code
    returning id into v_dest_id;

  if v_dest_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_order
    from wa_community_alias_destinations
    where alias_id = v_alias.id;

    insert into wa_community_alias_destinations (
      alias_id, invite_code, label, sort_order, is_active, activated_at
    ) values (
      v_alias.id,
      v_code,
      coalesce(nullif(btrim(coalesce(p_label, '')), ''), 'Group ' || (v_order + 1)::text),
      v_order,
      true,
      now()
    )
    returning id into v_dest_id;
  end if;

  update wa_community_aliases
    set active_invite_code = v_code,
        is_active = true,
        updated_by_user_id = p_actor
    where id = v_alias.id;

  insert into wa_community_alias_events (alias_id, user_id, action, detail)
  values (
    v_alias.id,
    p_actor,
    'repointed',
    jsonb_build_object(
      'from_invite_code', v_alias.active_invite_code,
      'to_invite_code', v_code,
      'destination_id', v_dest_id
    )
  );

  perform assert_wa_alias_invite_homes(v_alias.id);

  return jsonb_build_object(
    'alias_id', v_alias.id,
    'slug', v_alias.slug,
    'invite_code', v_code,
    'destination_id', v_dest_id
  );
end;
$$;

revoke all on function assert_wa_alias_invite_homes(uuid) from public, anon, authenticated;
revoke all on function trg_wa_alias_invite_homes_agree() from public, anon, authenticated;
revoke all on function create_community_alias(text, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function repoint_community_alias(text, text, uuid, text) from public, anon, authenticated;

grant execute on function create_community_alias(text, uuid, text, text, text, text, uuid, text) to service_role;
grant execute on function repoint_community_alias(text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
