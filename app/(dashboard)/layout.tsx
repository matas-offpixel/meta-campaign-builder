import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { FacebookConnectionBanner } from "@/components/facebook-connection-banner";

/**
 * Route-group layout for top-level dashboard pages (Today, Calendar, Clients,
 * Events, Campaigns, Reporting, Settings). The wizard route (/campaign/[id])
 * deliberately lives outside this group so it keeps its own full-width shell.
 *
 * `<FacebookConnectionBanner />` lives here so the connect-Facebook CTA is
 * always one click away from anywhere in the dashboard, not buried inside the
 * wizard. The widget on `/` is the authoritative status surface.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <DashboardNav />
      <div className="flex-1 min-w-0 flex flex-col">
        <FacebookConnectionBanner />
        {children}
      </div>
    </div>
  );
}
