import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlatformConnectionsSection } from "@/components/settings/platform-connections-section";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { getPlatformConnectionStatuses } from "@/lib/settings/connection-status";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const connections = await getPlatformConnectionStatuses(supabase, user);
  const displayName =
    (typeof user.user_metadata.full_name === "string" &&
      user.user_metadata.full_name) ||
    (typeof user.user_metadata.name === "string" && user.user_metadata.name) ||
    user.email ||
    user.id;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account, platform connections and workspace preferences."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-8">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Account
                </p>
                <h2 className="mt-1 font-heading text-xl tracking-wide text-foreground">
                  {displayName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {user.email ?? "No email on this account"}
                </p>
              </div>
              <SignOutButton />
            </div>
          </section>

          <PlatformConnectionsSection connections={connections} />

          <section className="rounded-lg border border-dashed border-border bg-card p-5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Workspace
            </p>
            <h2 className="mt-1 font-heading text-xl tracking-wide text-foreground">
              Team members and defaults
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Workspace roles, default launch settings and approval policies will
              live here once the onboarding flow needs multi-user management.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
