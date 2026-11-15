-- The 90% rung waits 14 days. Artwork refreshes every two weeks (Matas, 10 Nov).
-- Finds the rung by kind, value, template and options, so it is the same row
-- at position 2 today and at position 3 after the rung-1 split.
-- A row that is still the 211 seed (days 7, the seed template, the seed
-- options) moves to 14. An edited row is left as it is and the client is
-- named. A second run changes nothing. Nothing is deleted.
-- Written, not applied. 223 is the unmerged copy-features hash on cursor/rail-3.

do $$
declare
  seed jsonb := '{"days":7,"wording":"percent","alt":"final X {release} tickets"}'::jsonb;
  done jsonb := '{"days":14,"wording":"percent","alt":"final X {release} tickets"}'::jsonb;
  client record;
  seed_row boolean;
  done_row boolean;
begin
  for client in
    select c.id, c.name
    from public.clients c
    where exists (
      select 1 from public.client_claim_ladders l where l.client_id = c.id
    )
  loop
    select exists (
      select 1
      from public.client_claim_ladders l
      where l.client_id = client.id
        and l.trigger_kind = 'state_days'
        and l.trigger_value = 'selling_fast'
        and l.claim_template = '{release} 90% sold out'
        and l.options = seed
    ) into seed_row;

    if seed_row then
      update public.client_claim_ladders
      set options = done
      where client_id = client.id
        and trigger_kind = 'state_days'
        and trigger_value = 'selling_fast'
        and claim_template = '{release} 90% sold out'
        and options = seed;
      continue;
    end if;

    select exists (
      select 1
      from public.client_claim_ladders l
      where l.client_id = client.id
        and l.trigger_kind = 'state_days'
        and l.trigger_value = 'selling_fast'
        and l.claim_template = '{release} 90% sold out'
        and l.options = done
    ) into done_row;

    if not done_row then
      raise notice '224: % left the 90%% sold out rung unchanged', client.name;
    end if;
  end loop;
end $$;
