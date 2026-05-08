import { VenueShellSkeleton } from "@/components/dashboard/skeletons/venue-shell-skeleton";

/**
 * Streaming fallback for `/clients/[id]/venues/[event_code]`.
 * Renders immediately while the page server component awaits
 * `loadVenuePortalByCode(id, eventCode)` so the sticky header,
 * tab strip, topline stats grid, and trend chart all paint as
 * skeletons within ~50ms of clicking.
 */
export default function VenueReportLoading() {
  return <VenueShellSkeleton />;
}
