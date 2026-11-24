/**
 * lib/mcp/tools/index.ts — every M1 tool. All read-only.
 */
import type { McpTool } from "../tool-types.ts";
import { getDraftTool, getDraftsTool } from "./drafts.ts";
import { getEventTool, listEventsTool } from "./events.ts";
import { getLearningsTool } from "./learnings.ts";
import { getCampaignTreeTool, runLaunchChecksTool } from "./pending.ts";
import { morningToplineTool } from "./topline.ts";

export const MCP_TOOLS: readonly McpTool[] = [
  morningToplineTool,
  listEventsTool,
  getEventTool,
  getCampaignTreeTool,
  getLearningsTool,
  getDraftsTool,
  getDraftTool,
  runLaunchChecksTool,
];
