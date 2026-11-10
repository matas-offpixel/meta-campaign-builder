-- Split rung 1. Position 1 becomes "{release} live", only for the latest
-- release whose list time has passed. Position 2 is the new selling-fast
-- rung. Later rows move down one. Their ids stay. Nothing is deleted.
-- A ladder that is already split is left alone, with no notice. A ladder
-- whose position 1 is neither the 211 seed nor that split is named and
-- left untouched. A second run changes nothing.
-- Written, not applied. 224 stays as it is.

do $$
declare
  client record;
  rung1 public.client_claim_ladders%rowtype;
  already boolean;
  seed boolean;
begin
  for client in
    select c.id, c.name, c.user_id
    from public.clients c
    where exists (
      select 1 from public.client_claim_ladders l where l.client_id = c.id
    )
  loop
    select * into rung1
    from public.client_claim_ladders
    where client_id = client.id and position = 1;

    if rung1.id is null then
      raise notice '225: % has no rung 1, left unchanged', client.name;
      continue;
    end if;

    select exists (
      select 1
      from public.client_claim_ladders l
      where l.client_id = client.id
        and l.position = 2
        and l.trigger_kind = 'state'
        and l.trigger_value = 'selling_fast'
        and l.claim_template = '{release} selling fast'
    ) into already;

    if rung1.claim_template = '{release} live' and already then
      continue;
    end if;

    seed := rung1.trigger_kind = 'state'
      and rung1.trigger_value = 'on_sale'
      and rung1.claim_template = '{release} live · selling fast'
      and rung1.options = '{"days":0}'::jsonb;

    if not seed then
      raise notice '225: % left rung 1 unchanged', client.name;
      continue;
    end if;

    update public.client_claim_ladders
    set position = position + 100
    where client_id = client.id and position >= 2;

    update public.client_claim_ladders
    set position = position - 99
    where client_id = client.id and position >= 102;

    update public.client_claim_ladders
    set claim_template = '{release} live'
    where client_id = client.id and position = 1;

    insert into public.client_claim_ladders (
      user_id, client_id, position, trigger_kind, trigger_value, claim_template, options
    ) values (
      client.user_id,
      client.id,
      2,
      'state',
      'selling_fast',
      '{release} selling fast',
      '{"days":0,"or_earlier_sold_out":true}'::jsonb
    );
  end loop;
end $$;
