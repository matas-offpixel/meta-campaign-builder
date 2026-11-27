/**
 * lib/mcp/retargeting/types.ts — what plan_retargeting and create_retargeting
 * reach (M3c, scope mcp:meta, Matas only).
 *
 * The route passes the real one (lib/mcp/retargeting-deps.ts, a pinned
 * seam); tests pass spies.
 *   - read: the Retargeting campaign's 08:00 read (lib/retargeting/runner.ts
 *     runRetargetingRead) as a dry run: Meta GETs and database reads only,
 *     nothing written, whatever ENABLE_RETARGETING_READ says;
 *   - create: the funnel's create path (applyFunnel) for one show, with the
 *     app's own Meta calls and the three seams:
 *       createAudience — Job 2's audience create (today the app's audience
 *         builder, createAudienceDraft + createMetaCustomAudience);
 *       scheduleChange — M3b's scheduled change (scheduled_meta_changes,
 *         migration 271), with this create's chat yes; Job 1 switches the
 *         cron on;
 *       checkCeiling — Job 3's show ceiling (today the client ceiling,
 *         lib/mcp/meta/ceiling.ts, on the change in the show's total).
 *
 * Relative imports only (node:test).
 */
import type { FunnelBuild, FunnelOutcome } from "../../retargeting/funnel-apply.ts";
import type { RetargetingRecord } from "../../retargeting/runner.ts";
import type { FrontUnread } from "../../retargeting/limits.ts";

export interface RetargetingReadResult {
  records: RetargetingRecord[];
  metaGets: number;
  /** The read's own notes (counts and reasons, never a token or a raw body). */
  skipped: { eventCode: string | null; reason: string }[];
  /** Shows not finished in time (their own budget, or the whole read's): plan_retargeting says each; create_show_campaigns refuses. */
  unfinished?: { eventId: string; eventCode: string | null; why: "show" | "total" }[];
  /** Reads before the shows that ran out of time. */
  notRead?: FrontUnread[];
}

export interface McpRetargetingDeps {
  /** codes null = every on-sale show of a non-archived client. */
  read(input: { userId: string; codes: readonly string[] | null; now: Date }): Promise<RetargetingReadResult>;
  /** Staged (two campaigns): each campaign's effective_status now (GET /?ids=…), so a live Wider waits for the prospecting it folds. */
  campaignStatuses(input: { userId: string; ids: readonly string[] }): Promise<Record<string, string | null>>;
  /**
   * The funnel's create path for one show, as this operator
   * (lib/retargeting/funnel-apply.ts applyFunnel with the real Meta calls
   * and the three seams). Meta's errors come back as plain sentences only.
   */
  create(input: {
    userId: string;
    eventId: string;
    clientId: string | null;
    clientName: string | null;
    approval: { asked: string; answer: string };
    build: FunnelBuild;
    mode: "paused" | "live";
    today: string;
  }): Promise<{ outcome: FunnelOutcome; adsManager: string | null }>;
}
