import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { CmdKPalette } from "@/components/dashboard/cmd-k-palette";
import { InsightsRail } from "@/components/insights-rail/insights-rail";
import { InsightsRailProvider } from "@/components/insights-rail/rail-context";
import { isOperator } from "@/lib/auth/operator-allowlist";
import { createClient } from "@/lib/supabase/server";

/**
 * Route-group layout for top-level dashboard pages (Today, Calendar, Clients,
 * Events, Campaigns, Reporting, Settings). The wizard route (/campaign/[id])
 * deliberately lives outside this group so it keeps its own full-width shell.
 *
 * The Insights rail is mounted here and nowhere else (R3): never on
 * /admin/[clientSlug], /share/* or /l/*. Operators only (rule 12).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operator = Boolean(user && isOperator(user.id));
  return (
    <InsightsRailProvider operator={operator}>
      <div className="flex min-h-screen">
        <DashboardNav />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
        <InsightsRail />
        <CmdKPalette />
      </div>
    </InsightsRailProvider>
  );
}
