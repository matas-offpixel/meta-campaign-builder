/**
 * lib/dashboard/venue-campaign-end-date.ts
 *
 * Per-venue campaign end date = MAX(event_date) across all fixtures
 * sharing the same event_code.
 *
 * When at least one fixture is still upcoming (event_date ≥ today),
 * returns the latest upcoming date. When every fixture is in the past,
 * returns the latest past date. No special-casing for knockout stages —
 * inserting a Last-32 row with a later date automatically becomes the
 * new campaign end.
 */

export function venueCampaignEndDate(
  events: ReadonlyArray<{ event_date: string | null }>,
  today?: Date | string,
): string | null {
  const todayYmd =
    typeof today === "string"
      ? today.slice(0, 10)
      : (today ?? new Date()).toISOString().slice(0, 10);

  const upcoming = events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date && date >= todayYmd)
    .sort();

  if (upcoming.length > 0) return upcoming.at(-1)!;

  return (
    events
      .map((event) => event.event_date)
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? null
  );
}
