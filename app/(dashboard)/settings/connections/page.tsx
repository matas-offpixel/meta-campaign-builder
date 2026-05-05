import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlatformConnectionsSection } from "@/components/settings/platform-connections-section";
import { getPlatformConnectionStatuses } from "@/lib/settings/connection-status";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const connections = await getPlatformConnectionStatuses(supabase, user);

  return (
    <>
      <PageHeader
        title="Platform Connections"
        description="Manage OAuth and ticketing connectors used across launch and reporting."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-5xl">
          <PlatformConnectionsSection connections={connections} />
        </div>
      </main>
    </>
  );
}
