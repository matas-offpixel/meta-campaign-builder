/**
 * lib/mcp/meta/words.ts — what the mcp:meta tools tell Claude, word for word
 * from design's list (record 2026-11-25-mcp-full-control FC2, list
 * scratch/mcp/words-mcp-today-2026-11-25.tsv, sha256 5aeca085…). Pinned by
 * lib/mcp/__tests__/meta-words.test.ts against a copy of the list.
 *
 * {thing}/{things} are the builder's plain words per tool (TD's hand-back):
 * launch_draft "campaign"/"campaigns", upload_draft_assets "file"/"files",
 * update_event "event"/"events".
 *
 * Relative imports only (node:test).
 */

const gbp = (n: number) => n.toFixed(2);

export const MCP_WORDS = {
  /** claude.mcp.refused.no_approval */
  refusedNoApproval:
    "Refused: there’s no approval with this. Ask Matas in chat, then send his exact question and answer with it. Nothing was sent to Meta.",
  /** claude.mcp.refused (over the ceiling) */
  refusedOverCeiling: (client: string, x: number, c: number) =>
    `Refused: this would take ${client} to £${gbp(x)} a day, over its £${gbp(c)} daily ceiling. Nothing was sent to Meta.`,
  /** claude.mcp.refused.none (no ceiling, a change that starts spend) */
  refusedNoCeiling: (client: string) =>
    `Refused: ${client} has no daily ceiling, so nothing that starts spend can run. Matas sets one in Settings › Claude. Nothing was sent to Meta.`,
  /** claude.mcp.refused.checks / .checks.one */
  refusedChecks: (n: number) => (n === 1 ? "Refused: 1 launch check to fix. Nothing was sent to Meta." : `Refused: ${n} launch checks to fix. Nothing was sent to Meta.`),
  /** claude.mcp.done */
  done: (result: string) => `Done: ${result}.`,
  /** claude.mcp.undo_note: only where an Undo exists (FC1: a paused object Claude made). */
  undoNote: "Matas can undo this on Today.",
} as const;

/** today.mcp.result.* forms, for claude.mcp.done's {result}. */
export const RESULT_WORDS = {
  /** today.mcp.result.launched / .launched.one */
  launched: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} launched · ${ids[0]}` : `${ids.length} ${things[1]} launched · ${ids.join(", ")}`,
  /** today.mcp.result.added / .added.one */
  added: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} added · ${ids[0]}` : `${ids.length} ${things[1]} added · ${ids.join(", ")}`,
  /** today.mcp.result / .one */
  changed: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} changed · ${ids[0]}` : `${ids.length} ${things[1]} changed · ${ids.join(", ")}`,
} as const;

export const THINGS = {
  campaign: ["campaign", "campaigns"] as [string, string],
  file: ["file", "files"] as [string, string],
  event: ["event", "events"] as [string, string],
};
