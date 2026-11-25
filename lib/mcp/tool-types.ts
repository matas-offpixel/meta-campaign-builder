/**
 * lib/mcp/tool-types.ts
 *
 * The shape every MCP tool takes. M1 tools are kind 'read': readOnlyHint
 * true, destructiveHint false. Each one reuses an existing reader.
 *
 * M2 tools are kind 'draft' (scope mcp:draft): they change campaign_drafts
 * rows in the app database only, through lib/mcp/drafts/write.ts. Their
 * readOnlyHint is false (list_drive_creatives, which only reads, says true),
 * destructiveHint false. Meta, Drive and Storage reach them through
 * McpDraftDeps so the tests can spy on every call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodRawShape } from "zod";
import type { DriveApi } from "../drive/client.ts";
import type { LocationSearchHit } from "../meta/location-search.ts";

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

/** Launch checks (#1361) as M2 runs them after every write: `available: false` until that PR merges. */
export type LaunchChecksOutcome =
  | { available: false; status: "not available yet"; waitingOn: string }
  | { available: true; blockers: number; warnings: number; checks: unknown[] }
  | { available: true; error: string };

/** Audience templates (#1363) for apply_audience_template: null until that PR merges. */
export interface AudienceTemplatesSeam {
  apply(db: Db, input: { draft: Record<string, unknown>; template: string; userId: string }): Promise<{
    draft: Record<string, unknown>;
    reused: Array<{ name: string; id: string | null }>;
    willBeCreated: Array<{ name: string }>;
  } | { error: string }>;
}

/**
 * Everything an M2 tool reaches outside the database client. The route
 * passes the real ones (lib/mcp/draft-deps.ts); tests pass spies.
 */
export interface McpDraftDeps {
  /**
   * Meta adgeolocation search, through the location-search route's own
   * logic (lib/meta/location-search.ts, resolveServerMetaToken): GETs only.
   * `metaGets` is how many GETs this search made.
   */
  geoSearch(input: { userId: string; query: string; types: readonly string[] }): Promise<{ hits: LocationSearchHit[]; metaGets: number }>;
  /** The export Drive (driveFromEnv), or null when it isn't configured. */
  drive(): DriveApi | null;
  /** Storage writes the Drive picker's copy makes (uploadFileToStorageBucket, Storage copy). */
  uploadFile(storagePath: string, filePath: string, contentType: string): Promise<void>;
  copyObject(from: string, to: string): Promise<void>;
  /** #1361's checks for one draft, or null until it merges. */
  launchChecks: ((db: Db, draft: Record<string, unknown>) => Promise<{ blockers: number; warnings: number; checks: unknown[] }>) | null;
  /** #1363's templates, or null until it merges. */
  audienceTemplates: AudienceTemplatesSeam | null;
  /** New ids (draft, creatives). */
  newId(): string;
}

export interface ToolContext {
  db: Db;
  readers: McpReaders;
  userId: string;
  /** The grant's scope ("mcp:read" or "mcp:read mcp:draft"). Draft tools check it again. */
  scope?: string;
  /** M2's outside reach; absent on read-only setups. */
  draft?: McpDraftDeps;
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
  kind: "read" | "draft";
  /** MCP readOnlyHint. Defaults to kind === "read". */
  readOnly?: boolean;
  /** MCP idempotentHint. Defaults to kind === "read". */
  idempotent?: boolean;
  inputSchema: ZodRawShape;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome>;
}

/**
 * A plain refusal or a bad input: the message goes back to Claude as written,
 * and `summary` (ids and reasons, never person data) goes to mcp_actions.result.
 */
export class ToolInputError extends Error {
  readonly summary: Record<string, unknown> | null;
  /** Extra fields Claude gets beside the message (e.g. the hits to choose from). Never person data. */
  readonly data: Record<string, unknown> | null;
  constructor(message: string, summary: Record<string, unknown> | null = null, data: Record<string, unknown> | null = null) {
    super(message);
    this.summary = summary;
    this.data = data;
  }
}
