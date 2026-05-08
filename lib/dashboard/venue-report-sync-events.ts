/**
 * Dispatched from `VenueReportHeader` after a Sync now completes (including
 * partial failures that still run `router.refresh()`). Listeners refresh
 * Meta-backed satellite data such as the daily ad-set budget strip without
 * doubling up unthrottled Graph traffic.
 */
export const VENUE_REPORT_SYNC_COMPLETE_EVENT = "venue-report:sync-complete";
