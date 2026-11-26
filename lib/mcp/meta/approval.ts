/**
 * lib/mcp/meta/approval.ts — the chat-yes approval contract (M3a).
 *
 * Matas's ruling, 25 Nov (scratch/mcp/m3-full-control-2026-11-25.md): for
 * a Meta change through the connector, his typed yes in Claude is enough.
 * Every mcp:meta tool takes `approval: { asked, answer }`:
 *   - `asked`: the exact question Claude put in chat (what, where, money a
 *     day, paused or live);
 *   - `answer`: Matas's reply, verbatim.
 * Both must be non-empty and at most 1,000 characters. Missing, empty or
 * too long → refused before anything runs. The pair is stored on the
 * call's mcp_actions row with approval_source 'claude_prompt' (the server
 * does that, lib/mcp/server.ts → lib/mcp/action-log.ts).
 *
 * The server can't prove who typed the yes. The backstops are the scope
 * (MATAS_USER_IDS only), the per-show spend ceilings (lib/mcp/meta/show-ceiling.ts),
 * the action log and the kill switches (ENABLE_MCP, scripts/mcp-revoke.mts).
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { SCOPE_META } from "../config.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { ToolInputError, type McpMetaDeps, type ToolContext } from "../tool-types.ts";
import { APPROVAL_FIELD_WORDS, MCP_WORDS } from "./words.ts";

export const APPROVAL_MAX_CHARS = 1000;

export interface Approval {
  asked: string;
  answer: string;
}

/**
 * The input field every meta tool declares. Loose on purpose: a missing or
 * bad approval reaches the tool, which refuses it and is logged, rather
 * than failing the SDK's own input check with no mcp_actions row.
 */
export const approvalInput = z
  .object({
    asked: z.string().max(20_000).optional().describe(APPROVAL_FIELD_WORDS.asked),
    answer: z.string().max(20_000).optional().describe(APPROVAL_FIELD_WORDS.answer),
  })
  .optional()
  .describe(APPROVAL_FIELD_WORDS.approval);

export const APPROVAL_WORDS = {
  /** claude.mcp.refused.no_approval: missing, empty, or over the limit (an approval that can't be stored isn't one). */
  missing: MCP_WORDS.refusedNoApproval,
  tooLong: MCP_WORDS.refusedNoApproval,
  /** claude.mcp.refused.scope: the in-tool backstop (the server answers 403 insufficient_scope first). */
  notMeta: MCP_WORDS.refusedScope,
} as const;

/** The approval, or null when it is missing or empty. Throws on a value over the limit. */
export function parseApproval(value: unknown): Approval | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const asked = typeof v.asked === "string" ? v.asked.trim() : "";
  const answer = typeof v.answer === "string" ? v.answer.trim() : "";
  if (!asked || !answer) return null;
  if ([...asked].length > APPROVAL_MAX_CHARS || [...answer].length > APPROVAL_MAX_CHARS) {
    throw new ToolInputError(APPROVAL_WORDS.tooLong, { refused: "approval_too_long" });
  }
  return { asked, answer };
}

/**
 * The first thing every meta tool runs: the scope (mcp:meta, MATAS_USER_IDS
 * again) and the approval. Nothing is read or sent before it passes.
 */
export function requireMetaApproval(ctx: ToolContext, args: Record<string, unknown>): { meta: McpMetaDeps | undefined; approval: Approval } {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_META) || ctx.isMatas !== true) {
    throw new ToolInputError(APPROVAL_WORDS.notMeta, { refused: "insufficient_scope" });
  }
  const approval = parseApproval(args.approval);
  if (!approval) throw new ToolInputError(APPROVAL_WORDS.missing, { refused: "no_approval" });
  return { meta: ctx.meta, approval };
}
