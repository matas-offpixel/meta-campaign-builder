/**
 * lib/mcp/drafts/common.ts
 *
 * What every M2 draft tool shares: the scope check, the launch checks after
 * a write (#1361, through ctx.draft.launchChecks; "not available yet" until
 * that PR merges) and the before → after summary for mcp_actions.result
 * (ids, counts and fields changed; never person data, never copy).
 */
import { SCOPE_DRAFT } from "../config.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import type { CampaignDraft } from "../../types.ts";
import { ToolInputError, type LaunchChecksOutcome, type McpDraftDeps, type ToolContext } from "../tool-types.ts";

export const NOT_YET = "not available yet" as const;

/** The server refuses first (403 insufficient_scope); this is the same rule again inside the tool. */
export function requireDraftScope(ctx: ToolContext): McpDraftDeps {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_DRAFT)) {
    throw new ToolInputError("This connection can only read. Reconnect Off/Pixel in Claude and allow draft changes.", { refused: "insufficient_scope" });
  }
  if (!ctx.draft) throw new Error("draft deps missing");
  return ctx.draft;
}

/** #1361's checks for the draft as saved, or "not available yet". Never throws: a failed check run is reported, not fatal. */
export async function launchChecksFor(ctx: ToolContext, draft: CampaignDraft): Promise<LaunchChecksOutcome> {
  const run = ctx.draft?.launchChecks ?? null;
  if (!run) return { available: false, status: NOT_YET, waitingOn: "PR #1361 (launch checks)" };
  try {
    const out = await run(ctx.db, draft as unknown as Record<string, unknown>);
    return { available: true, blockers: out.blockers, warnings: out.warnings, checks: out.checks };
  } catch {
    return { available: true, error: "The launch checks couldn't run. The change is saved." };
  }
}

/** A launch-checks outcome as counts for the action log. */
export function checksSummary(c: LaunchChecksOutcome): Record<string, unknown> {
  if (!c.available) return { launchChecks: NOT_YET };
  if ("error" in c) return { launchChecks: "error" };
  return { launchChecks: { blockers: c.blockers, warnings: c.warnings } };
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
