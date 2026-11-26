/**
 * lib/mcp/live/shipped.ts — whether M3b's live tools are on.
 *
 * M3b shipped switched off (design's verdict, 26 Nov) until Today's log rows
 * for connector changes landed. Record 2026-11-26-mcp-m3b-today (MB4): the PR
 * that builds those rows (lib/mcp/today/) sets this and TODAY_UNDO_SHIPPED
 * (lib/mcp/meta/today-undo.ts) to true together; a test pins the two
 * together. Off, every M3b tool answers claude.mcp.refused.switch ("Refused:
 * this is switched off in Off/Pixel. Nothing was sent to Meta.") before it
 * reads or sends anything, and the scheduled-changes cron applies nothing.
 * It is a code constant, not an env var.
 *
 * Tests inject ToolContext.liveShipped to cover both states.
 *
 * Relative imports only (node:test).
 */
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { LIVE_ROWS } from "./words.ts";

export const LIVE_CHANGES_SHIPPED = true;

/** The eleven M3b tools by name. */
export const LIVE_TOOL_NAMES = [
  "get_live",
  "pause",
  "resume",
  "set_budget",
  "list_scheduled",
  "cancel_scheduled",
  "move_budget",
  "rename",
  "add_creatives_to_stage",
  "add_audience_to_stage",
  "create_split_test",
] as const;

export function liveChangesOn(ctx: Pick<ToolContext, "liveShipped">): boolean {
  return ctx.liveShipped ?? LIVE_CHANGES_SHIPPED;
}

/** An M3b tool that refuses with claude.mcp.refused.switch while M3b is off, before anything runs. */
export function switchedOffUntilShipped(tool: McpTool): McpTool {
  return {
    ...tool,
    async run(ctx, args) {
      if (!liveChangesOn(ctx)) throw new ToolInputError(LIVE_ROWS.refusedSwitch, { refused: "switch_off", switch: "m3b_not_shipped" });
      return tool.run(ctx, args);
    },
  };
}
