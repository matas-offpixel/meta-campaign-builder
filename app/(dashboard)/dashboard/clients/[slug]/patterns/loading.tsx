import { DashboardShellSkeleton } from "@/components/dashboard/skeletons/dashboard-shell-skeleton";

/**
 * Streaming fallback for the legacy
 * `/dashboard/clients/[slug]/patterns` route. The page itself is a
 * `permanentRedirect` to `/clients/[id]/dashboard?tab=insights` —
 * the redirect runs server-side after a client lookup, so the user
 * still sees a brief in-flight render. This skeleton avoids the
 * blank-screen flash during the redirect's database round-trip.
 */
export default function LegacyPatternsLoading() {
  return <DashboardShellSkeleton />;
}
