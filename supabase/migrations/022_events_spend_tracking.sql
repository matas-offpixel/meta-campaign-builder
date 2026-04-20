-- Migration 022 — Per-event spend & pricing tracking for the client portal.
--
-- The /share/client/[token] portal is being reshaped from a ticket-input form
-- into the venue-grouped reporting dashboard 4theFans (and similar clients)
-- previously kept in a Google Sheet. That table needs three numbers off the
-- events row that we never stored before:
--
--   ticket_price    — face value per ticket. Drives Ticket Revenue =
--                     tickets_sold × ticket_price on the portal.
--   ad_spend_actual — actual Meta campaign spend allocated to this event.
--                     Set by admin (not derived from Meta insights yet) so
--                     the per-event split stays manual until we wire up
--                     spend attribution.
--   prereg_spend    — pre-registration / D2C phase spend booked against
--                     this event. Shown on the portal as "Pre-reg".
--
-- All three are nullable — historical rows have no data and the portal
-- already renders "—" placeholders for missing inputs.
--
-- RLS untouched: the existing per-user policies on events already cover
-- these new columns.

alter table events
  add column if not exists ticket_price    numeric(8,2),
  add column if not exists ad_spend_actual numeric(10,2),
  add column if not exists prereg_spend    numeric(10,2);

comment on column events.ticket_price    is
  'Face value per ticket (e.g. 7.69). Used to compute Ticket Revenue = tickets_sold × ticket_price.';
comment on column events.ad_spend_actual is
  'Actual Meta campaign spend allocated to this event. Admin sets this; shown on the portal as "Ad Spend".';
comment on column events.prereg_spend    is
  'Pre-registration / D2C phase spend for this event. Shown on the portal as "Pre-reg".';

notify pgrst, 'reload schema';
