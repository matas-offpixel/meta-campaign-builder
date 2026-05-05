import { ConnectionCard } from "@/components/settings/connection-card";
import type { PlatformConnectionStatus } from "@/lib/settings/connection-status";

export function PlatformConnectionsSection({
  connections,
}: {
  connections: PlatformConnectionStatus[];
}) {
  return (
    <section className="space-y-4" id="platform-connections">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Platform Connections
        </p>
        <h2 className="mt-1 font-heading text-xl tracking-wide text-foreground">
          OAuth and data connectors
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Manage the auth surface for campaign launch, reporting, ticketing
          rollups and the Meta App Review demo flow.
        </p>
      </div>
      <div className="grid gap-4">
        {connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} />
        ))}
      </div>
    </section>
  );
}
