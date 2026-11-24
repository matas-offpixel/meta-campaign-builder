/**
 * lib/mcp/tool-types.ts
 *
 * The shape every MCP tool takes. M1 tools are kind 'read': readOnlyHint
 * true, destructiveHint false. Each one reuses an existing reader.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodRawShape } from "zod";

export type Db = Pick<SupabaseClient, "from">;

export interface TicketSnapshotLite {
  snapshot_at: string;
  tickets_sold: number | null;
  source: string | null;
}

/**
 * The existing readers that can't load under plain node:test (`@/` value
 * imports). The route passes the real ones (lib/mcp/readers.ts); tests pass
 * fakes.
 */
export interface McpReaders {
  /** lib/db/ticketing.ts listAllSnapshotsForEvent (paged, oldest first). */
  ticketSnapshots(db: Db, eventId: string): Promise<TicketSnapshotLite[]>;
  /** lib/autosave.ts migrateDraft: draft_json → CampaignDraft. */
  migrateDraft(raw: Record<string, unknown>): Record<string, unknown>;
}

export interface ToolContext {
  db: Db;
  readers: McpReaders;
  userId: string;
  /** MATAS_USER_IDS sees client names on cross-client learnings; other operators don't. */
  seesClientNames: boolean;
  /** Today's London date (YYYY-MM-DD); injected so tests are stable. */
  today: string;
  now: Date;
}

export interface ToolOutcome<T = unknown> {
  data: T;
  /** Ids for the action log (never person data). */
  eventId?: string | null;
  clientId?: string | null;
  /** Counts and ids for mcp_actions.result. */
  summary: Record<string, unknown>;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  kind: "read";
  inputSchema: ZodRawShape;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome>;
}

export class ToolInputError extends Error {}
