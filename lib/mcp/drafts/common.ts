/**
 * lib/mcp/drafts/common.ts
 *
 * What every draft tool shares: the scope check, the launch checks after a
 * write (runLaunchGuard, as POST /api/launch-guard runs it: database reads
 * only, no live identity read, so no Meta call) and the before → after
 * summary for mcp_actions.result (ids, counts and fields changed; never
 * person data, never copy).
 */
import { SCOPE_DRAFT } from "../config.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { runLaunchGuard } from "../../launch-guard/load.ts";
import type { LaunchCheck } from "../../launch-guard/types.ts";
import type { CampaignDraft } from "../../types.ts";
import { ToolInputError, type Db, type LaunchCheckLine, type LaunchChecksOutcome, type McpDraftDeps, type ToolContext } from "../tool-types.ts";

/** The server refuses first (403 insufficient_scope); this is the same rule again inside the tool. */
export function requireDraftScope(ctx: ToolContext): McpDraftDeps {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_DRAFT)) {
    throw new ToolInputError("This connection can only read. Reconnect Off/Pixel in Claude and allow draft changes.", { refused: "insufficient_scope" });
  }
  if (!ctx.draft) throw new Error("draft deps missing");
  return ctx.draft;
}

export const CHECKS_FAILED = "The launch checks couldn't run. The change is saved." as const;

function lineOf(c: LaunchCheck): LaunchCheckLine {
  return { key: c.key, severity: c.severity, label: c.label, sentence: c.sentence, evidence: c.evidence, fixes: c.fixes.map((f) => f.label) };
}

/** runLaunchGuard for one draft, in the record's words. Throws only when the check can't run. */
export async function runChecks(db: Db, draft: CampaignDraft): Promise<{ blockers: number; warnings: number; checks: LaunchCheckLine[] }> {
  const r = await runLaunchGuard(db, draft, null);
  return { blockers: r.blockers, warnings: r.warnings, checks: r.checks.map(lineOf) };
}

/** The launch checks for the draft as saved. Never throws: a failed run is reported, not fatal. */
export async function launchChecksFor(ctx: ToolContext, draft: CampaignDraft): Promise<LaunchChecksOutcome> {
  try {
    return { ran: true, ...(await runChecks(ctx.db, draft)) };
  } catch {
    return { ran: false, error: CHECKS_FAILED };
  }
}

/** A launch-checks outcome as counts and keys for the action log. */
export function checksSummary(c: LaunchChecksOutcome): Record<string, unknown> {
  if (!c.ran) return { launchChecks: "error" };
  return { launchChecks: { blockers: c.blockers, warnings: c.warnings, keys: [...new Set(c.checks.map((x) => x.key))] } };
}

export interface Change {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

/** One line per field that changed, `from` → `to`. */
export function changes(pairs: ReadonlyArray<[field: string, from: unknown, to: unknown]>): Change[] {
  const norm = (v: unknown): string | number | null => (v == null || v === "" ? null : typeof v === "number" ? v : String(v));
  return pairs.filter(([, a, b]) => norm(a) !== norm(b)).map(([field, a, b]) => ({ field, from: norm(a), to: norm(b) }));
}

/** The host and path of a link, for summaries (no query string: UTMs stay out of the log). */
export function linkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase() || null;
  }
}
