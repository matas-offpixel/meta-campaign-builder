import { DashboardShellSkeleton } from "@/components/dashboard/skeletons/dashboard-shell-skeleton";

/**
 * Streaming fallback for `/clients/[id]/dashboard`. Renders
 * immediately while the page server component awaits
 * `loadClientPortalByClientId(id)` — Joe sees the dashboard
 * shell within ~50ms of clicking, instead of staring at a blank
 * screen for the duration of the loader.
 */
export default function ClientDashboardLoading() {
  return <DashboardShellSkeleton />;
}
