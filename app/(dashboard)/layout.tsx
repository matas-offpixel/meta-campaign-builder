import { DashboardNav } from "@/components/dashboard/dashboard-nav";

/**
 * Route-group layout for top-level dashboard pages (Today, Calendar, Clients,
 * Events, Campaigns, Reporting, Settings). The wizard route (/campaign/[id])
 * deliberately lives outside this group so it keeps its own full-width shell.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <DashboardNav />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
