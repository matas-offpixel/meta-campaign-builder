/**
 * Campaign-name matching for the reporting-layer TikTok adapter.
 *
 * The naming convention asks operators to include `[event_code]` in campaign
 * names, but the reporting route intentionally mirrors
 * `lib/reporting/event-insights.ts`: match the bare event_code as a
 * case-insensitive substring. This keeps the UI forgiving when a platform or
 * operator varies bracket casing, while still relying on event_code as the
 * canonical join key.
 */
export function campaignNameMatchesEventCode(
  campaignName: string,
  eventCode: string,
): boolean {
  const needle = eventCode.trim();
  if (!needle) return false;
  return campaignName.toLowerCase().includes(needle.toLowerCase());
}
