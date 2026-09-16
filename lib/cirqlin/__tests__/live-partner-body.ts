/**
 * The body `GET /api/partner/signups?tag=` returns, as merged in
 * cirqlin#426 — `pages[]`, `multiple`, `daily_timezone`. The first
 * two prompts disagreed on `page` vs `pages` and this side had the
 * singular, so every live read failed the guard and the card sat on
 * the Mailchimp segment count. Keep this fixture shaped like the
 * route, not like our type.
 */

import type { CirqlinSignupsPayload } from "../types.ts";

export const CIRQLIN_LIVE_BODY: CirqlinSignupsPayload = {
  ok: true,
  tag: "CQ-dod-newcastle",
  pages: [
    {
      id: "e0b4a82d-a530-49a8-a04d-e5494b947d14",
      slug: "dod-newcastle",
      title: "D.O.D",
      event_date: "2026-10-31",
      onsale_at: "2026-09-09T13:00:00.000Z",
      presale_at: "2026-09-09T11:00:00.000Z",
      timezone: "Europe/London",
    },
  ],
  multiple: false,
  totals: { signups: 1844, spam_flagged: 1, counted: 1843 },
  daily: [
    { day: "2026-08-18", signups: 12 },
    { day: "2026-08-26", signups: 64 },
    { day: "2026-09-09", signups: 8 },
  ],
  daily_timezone: "Europe/London",
  sync: {
    mailchimp: { synced: 1837, failed: 4, skipped: 1 },
    bird: { synced: 0, failed: 0, skipped: 0 },
  },
  capturedAt: "2026-09-15T12:00:00.000Z",
};

/** The same body with the field named as this repo used to expect it. */
export function withSingularPage(
  body: CirqlinSignupsPayload = CIRQLIN_LIVE_BODY,
): Record<string, unknown> {
  const { pages, ...rest } = body;
  return { ...rest, page: pages[0] };
}
