import type { EventWithClient } from "@/lib/db/events";

/**
 * lib/wizard/phase.ts
 *
 * Pure helper that derives a campaign phase label from an event's
 * milestones relative to "now". Used to default the wizard's campaign
 * name to `${event.name} — ${phase}`.
 *
 * Phase order (first match wins):
 *   - announcement_at null OR now < announcement_at  → "Pre-announce"
 *   - now < presale_at (or presale_at null)          → "Announce"
 *   - now < general_sale_at (or null)                → "Presale"
 *   - now < event_date − 3 days                      → "On sale"
 *   - now between event_date − 3 days and event_date → "Final push"
 *   - now > event_date                               → "Post-event"
 *   - event has no dates at all                      → "Campaign"
 */

export type CampaignPhase =
  | "Pre-announce"
  | "Announce"
  | "Presale"
  | "On sale"
  | "Final push"
  | "Post-event"
  | "Campaign";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(value: string): Date | null {
  const d = toDate(`${value}T23:59:59`);
  return d;
}

export function derivePhase(
  event: Pick<
    EventWithClient,
    | "announcement_at"
    | "presale_at"
    | "general_sale_at"
    | "event_date"
    | "event_start_at"
  >,
  now: Date = new Date(),
): CampaignPhase {
  const announcement = toDate(event.announcement_at);
  const presale = toDate(event.presale_at);
  const generalSale = toDate(event.general_sale_at);
  // Prefer event_start_at when present (carries time + timezone); fall
  // back to event_date at end-of-day so post-event isn't entered until
  // the calendar date has fully elapsed.
  const eventDate =
    toDate(event.event_start_at) ??
    (event.event_date ? endOfDay(event.event_date) : null);

  // No dates at all — caller has nothing to anchor the phase on.
  if (!announcement && !presale && !generalSale && !eventDate) {
    return "Campaign";
  }

  // Past the event itself.
  if (eventDate && now > eventDate) return "Post-event";

  // Within 3 days of the event.
  if (eventDate) {
    const finalPushStart = new Date(eventDate.getTime() - 3 * DAY_MS);
    if (now >= finalPushStart && now <= eventDate) return "Final push";
  }

  if (!announcement || now < announcement) return "Pre-announce";
  if (!presale || now < presale) return "Announce";
  if (!generalSale || now < generalSale) return "Presale";

  // Past general sale but more than 3 days from event date (or event
  // date isn't set) — broad on-sale push.
  return "On sale";
}
