/**
 * lib/mcp/meta/today-undo.ts — whether Today's Undo exists yet (M3a).
 *
 * claude.mcp.undo_note ("Matas can undo this on Today.") goes out only where
 * an Undo exists (FC1, FC2). Today's Undo ships in M3b, so until then a
 * paused launch says Done without it. M3b sets this to true in the same PR
 * that ships the Undo. It is a code constant, not an env var.
 *
 * Tests inject ToolContext.todayUndo to cover both states.
 */
export const TODAY_UNDO_SHIPPED = false;
