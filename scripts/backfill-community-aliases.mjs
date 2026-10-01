#!/usr/bin/env node
/**
 * Dry-run list of D2C events that have a WhatsApp group and no alias yet.
 *
 * Does not write. Passing --apply prints the INSERT shape and exits non-zero
 * until someone has read a fresh dry run and removed the guard below.
 *
 * Candidates:
 *   - d2c_event_copy.whatsapp_community_url is set
 *   - event_date is today or later, OR a scheduled send is still in the future
 *   - no wa_community_aliases row whose slug equals events.slug
 *   - the invite code is not already an active destination
 *
 * Events with no group are excluded. Legacy raw-invite templates are not
 * touched; this script never updates Bird or Mailchimp.
 *
 * Dry run 27 Sep 2026 against zbtldbfjbhfvpksmdvnt: zero rows.
 * Upcoming events had a null whatsapp_community_url.
 */

const SQL = `
select e.id,
       e.slug,
       e.name,
       e.event_date,
       substring(c.whatsapp_community_url from 'chat\\.whatsapp\\.com/([A-Za-z0-9]{8,30})') as invite_code
from d2c_event_copy c
join events e on e.id = c.event_id
where c.whatsapp_community_url is not null
  and (
    e.event_date >= current_date
    or exists (
      select 1
      from d2c_scheduled_sends s
      where s.event_id = e.id
        and s.status = 'scheduled'
        and s.scheduled_for >= now()
    )
  )
  and not exists (
    select 1 from wa_community_aliases a where a.slug = e.slug
  )
  and not exists (
    select 1
    from wa_community_alias_destinations d
    where d.is_active = true
      and d.invite_code = substring(
        c.whatsapp_community_url from 'chat\\.whatsapp\\.com/([A-Za-z0-9]{8,30})'
      )
  )
order by e.event_date, e.slug;
`;

const apply = process.argv.includes("--apply");

console.log(SQL.trim());
console.log("");
console.log("Dry run recorded 27 Sep 2026: 0 rows. Re-run this SELECT and read it before any insert.");

if (apply) {
  console.error(
    "Refusing to write. Read a fresh dry-run result, then call create_community_alias per docs/community-aliases.md.",
  );
  process.exit(1);
}
