/**
 * lib/mcp/readers.ts
 *
 * The real readers behind McpReaders, for the route. Not imported by tests.
 */
import "server-only";
import { listAllSnapshotsForEvent } from "@/lib/db/ticketing";
import { migrateDraft } from "@/lib/autosave";
import type { McpReaders } from "./tool-types";

export const realReaders: McpReaders = {
  async ticketSnapshots(db, eventId) {
    const rows = await listAllSnapshotsForEvent(db as never, eventId);
    return rows.map((r) => ({ snapshot_at: r.snapshot_at, tickets_sold: r.tickets_sold ?? null, source: (r.source as string | null) ?? null }));
  },
  migrateDraft(raw) {
    return migrateDraft(raw) as unknown as Record<string, unknown>;
  },
};
