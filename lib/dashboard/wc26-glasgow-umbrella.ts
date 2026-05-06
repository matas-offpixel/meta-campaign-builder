/**
 * WC26 Glasgow has two venue rows (SWG3 + O2) plus shared umbrella Meta
 * campaigns tagged `[WC26-GLASGOW]` (without venue suffix). Those umbrellas
 * do not match `[WC26-GLASGOW-SWG3]` / `[WC26-GLASGOW-O2]` filters — see
 * docs/RECONCILIATION_AUDIT_2026-05-05.md. Insights helpers merge a second
 * `[WC26-GLASGOW]` fetch and route umbrella rows by calendar day vs cutover.
 */

/**
 * Last calendar day (YYYY-MM-DD) umbrella spend belongs to SWG3; spend after
 * this day routes to O2. Operator: confirm vs SWG3 off-sale / sold-out from
 * ticketing (capacity vs tickets_sold), then adjust if needed.
 */
export const WC26_GLASGOW_UMBRELLA_CUTOVER_DATE = "2026-05-04";

export const WC26_GLASGOW_SWG3_EVENT_CODE = "WC26-GLASGOW-SWG3";
export const WC26_GLASGOW_O2_EVENT_CODE = "WC26-GLASGOW-O2";

const WC26_GLASGOW_UMBRELLA_BRACKET = "[WC26-GLASGOW]";
const WC26_GLASGOW_SWG3_BRACKET = "[WC26-GLASGOW-SWG3]";
const WC26_GLASGOW_O2_BRACKET = "[WC26-GLASGOW-O2]";

export function isWc26GlasgowVenueSiblingEventCode(eventCode: string): boolean {
  return (
    eventCode === WC26_GLASGOW_SWG3_EVENT_CODE ||
    eventCode === WC26_GLASGOW_O2_EVENT_CODE
  );
}

/**
 * Umbrella-only campaigns: `[WC26-GLASGOW]` without venue suffix tags.
 * Venue-specific rows use `[WC26-GLASGOW-SWG3]` / `[WC26-GLASGOW-O2]` and are
 * attributed solely by name match.
 */
export function isWc26GlasgowUmbrellaOnlyCampaignName(
  campaignName: string,
): boolean {
  const n = campaignName;
  if (!n.includes(WC26_GLASGOW_UMBRELLA_BRACKET)) return false;
  if (n.includes(WC26_GLASGOW_SWG3_BRACKET)) return false;
  if (n.includes(WC26_GLASGOW_O2_BRACKET)) return false;
  return true;
}

/** Which WC26 Glasgow venue row owns umbrella spend on this rollup day. */
export function wc26GlasgowUmbrellaSpendBelongsToVenueEvent(
  venueEventCode: string,
  rollupDayYmd: string,
): boolean {
  const cutover = WC26_GLASGOW_UMBRELLA_CUTOVER_DATE;
  if (venueEventCode === WC26_GLASGOW_SWG3_EVENT_CODE) {
    return rollupDayYmd <= cutover;
  }
  if (venueEventCode === WC26_GLASGOW_O2_EVENT_CODE) {
    return rollupDayYmd > cutover;
  }
  return false;
}
