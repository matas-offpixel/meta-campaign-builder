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
import type { AccountPage, InterestHit } from "./graph-reads.ts";
import type { CampaignDraft } from "../types.ts";
import type { StoredSendOutcome } from "../plan/stored-assets-meta.ts";

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

/** One launch check as the record words it (lib/launch-guard/words.ts): what Claude reads back. */
export interface LaunchCheckLine {
  key: string;
  severity: "blocker" | "warning";
  label: string;
  sentence: string;
  evidence: string;
  /** The fix buttons' words. */
  fixes: string[];
}

/** The wizard's step checks (validateStep(7), as Review runs them), in the wizard's words. */
export interface WizardChecks {
  blockers: string[];
  warnings: string[];
  /** Files in Storage that go to Meta at launch (M3a): not blockers. */
  sendAtLaunch?: number;
  error?: string;
}

/**
 * After a write or from run_launch_checks: runLaunchGuard's result (blockers,
 * warnings, checks) and, separately, the wizard's step checks (wizard). A
 * failed run is reported, never fatal.
 */
export type LaunchChecksOutcome =
  | { ran: true; blockers: number; warnings: number; checks: LaunchCheckLine[]; wizard: WizardChecks }
  | { ran: false; error: string; wizard: WizardChecks };

/**
 * Everything a draft tool reaches outside the database client. The route
 * passes the real ones (lib/mcp/draft-deps.ts); tests pass spies. The three
 * Meta reads are GETs (lib/mcp/graph-reads.ts); nothing here writes Meta.
 */
export interface McpDraftDeps {
  /**
   * Meta adgeolocation search, through the location-search route's own
   * logic (lib/meta/location-search.ts, resolveServerMetaToken): GETs only.
   * `metaGets` is how many GETs this search made.
   */
  geoSearch(input: { userId: string; query: string; types: readonly string[] }): Promise<{ hits: LocationSearchHit[]; metaGets: number }>;
  /**
   * Meta interest search, the Audiences step's picker (GET /api/meta/interest-search):
   * one GET to Graph /search?type=adinterest.
   */
  interestSearch(input: { userId: string; query: string }): Promise<{ hits: InterestHit[]; metaGets: number }>;
  /**
   * The pages an ad account can run ads from: /{act}/promote_pages, the page
   * picker's list Meta checks at launch. GETs only (paged).
   */
  pagesForAccount(input: { userId: string; adAccountId: string }): Promise<{ pages: AccountPage[]; metaGets: number; truncated: boolean }>;
  /** The export Drive (driveFromEnv), or null when it isn't configured. */
  drive(): DriveApi | null;
  /** Storage writes the Drive picker's copy makes (uploadFileToStorageBucket, Storage copy). */
  uploadFile(storagePath: string, filePath: string, contentType: string): Promise<void>;
  copyObject(from: string, to: string): Promise<void>;
  /** New ids (draft, creatives). */
  newId(): string;
}

/**
 * M3a's reach to Meta (scope mcp:meta), each one the app's own path for one
 * operator. The route passes the real ones (lib/mcp/meta-deps.ts); tests
 * pass spies. No other MCP code reaches Meta's write API.
 */
export interface McpMetaDeps {
  /**
   * Standalone Launch's first step: every slot whose file is in Storage goes
   * to the draft's ad account through the MML path
   * (sendStoredDraftAssetsToMeta, handleUploadAsset bound to this user).
   * Saves nothing.
   */
  sendAssets(input: { userId: string; draft: CampaignDraft }): Promise<StoredSendOutcome>;
  /**
   * Review & Launch's route (POST /api/meta/launch-campaign through
   * launchCampaignAs) for this user. `createPaused` is the route's own flag:
   * campaign, ad sets and ads are created PAUSED.
   */
  launch(input: { userId: string; draft: CampaignDraft; createPaused: boolean }): Promise<{ status: number; body: Record<string, unknown> }>;
}

export interface ToolContext {
  db: Db;
  readers: McpReaders;
  userId: string;
  /** The grant's scope ("mcp:read" or "mcp:read mcp:draft"). Draft tools check it again. */
  scope?: string;
  /** M2's outside reach; absent on read-only setups. */
  draft?: McpDraftDeps;
  /** M3a's Meta reach (launch, uploads); absent unless the route wires it. */
  meta?: McpMetaDeps;
  /** The caller is in MATAS_USER_IDS (mcp:meta tools check it again). */
  isMatas?: boolean;
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
  kind: "read" | "draft" | "meta";
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
