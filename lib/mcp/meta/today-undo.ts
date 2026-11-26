/**
 * lib/mcp/meta/today-undo.ts — whether Today's Undo exists (M3a, on in M3b).
 *
 * claude.mcp.undo_note ("Matas can undo this on Today.") goes out only where
 * an Undo exists (FC1, FC2). Record 2026-11-26-mcp-m3b-today (MB4) flips this
 * and LIVE_CHANGES_SHIPPED (lib/mcp/live/shipped.ts) together, in the PR that
 * puts M3b's rows and Undo on Today; a test pins the two together. It is a
 * code constant, not an env var.
 *
 * Tests inject ToolContext.todayUndo to cover both states.
 */
export const TODAY_UNDO_SHIPPED = true;

/** Whether "Matas can undo this on Today." goes out for a change with an Undo. */
export function undoOnToday(ctx: { todayUndo?: boolean }): boolean {
  return ctx.todayUndo ?? TODAY_UNDO_SHIPPED;
}
