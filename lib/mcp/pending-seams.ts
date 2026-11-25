/**
 * lib/mcp/pending-seams.ts
 *
 * The one place the MCP waits on open PRs. Each seam is null until its PR
 * is on main; then it is wired here, in one line, and every tool that uses
 * it lights up (run_launch_checks, the launch checks every M2 write returns,
 * apply_audience_template). Until then they answer "not available yet".
 *
 *   - #1361 launch checks: `runLaunchGuard(db, draft, null)` from
 *     lib/launch-guard/load.ts, as POST /api/launch-guard calls it (no live
 *     identity read: no Meta call). Wire as
 *       launchChecks: async (db, draft) => { const r = await runLaunchGuard(db, draft as CampaignDraft, null);
 *         return { blockers: r.blockers.length, warnings: r.warnings.length, checks: [...r.blockers, ...r.warnings] }; }
 *   - #1363 audience templates: lib/audience-templates/resolve.ts
 *     (resolveTemplate: Reused / Will be created from stored rows, never Meta).
 */
import type { McpDraftDeps } from "./tool-types";

export const PENDING_SEAMS: Pick<McpDraftDeps, "launchChecks" | "audienceTemplates"> = {
  launchChecks: null,
  audienceTemplates: null,
};
