/**
 * lib/mcp/live/shipped.ts — M3b ships switched off (design's verdict, 26 Nov).
 *
 * Until Today's log rows for connector changes land, every M3b tool answers
 * the existing claude.mcp.refused.switch row ("Refused: this is switched off
 * in Off/Pixel. Nothing was sent to Meta.") before it reads or sends
 * anything, and the scheduled-changes cron applies nothing. Like
 * TODAY_UNDO_SHIPPED (lib/mcp/meta/today-undo.ts) it is a code constant, not
 * an env var: the PR that ships Today's rows sets it to true.
 *
 * Tests inject ToolContext.liveShipped to cover both states.
 *
 * Relative imports only (node:test).
 */
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { LIVE_ROWS } from "./words.ts";

export const LIVE_CHANGES_SHIPPED = false;

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
