/**
 * lib/mcp/tools/index.ts — every MCP tool.
 *
 * M1's eight read tools (scope mcp:read), then M2's eight draft tools
 * (scope mcp:draft: app database only, campaign_drafts with status draft).
 */
import type { McpTool } from "../tool-types.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "./draft-drive.ts";
import { applyAudienceTemplateTool, archiveDraftTool, setDraftBudgetTool, setDraftLinkTool, setDraftLocationsTool } from "./draft-edit.ts";
import { replicateToEventTool } from "./draft-replicate.ts";
import { getDraftTool, getDraftsTool } from "./drafts.ts";
import { getEventTool, listEventsTool } from "./events.ts";
import { getLearningsTool } from "./learnings.ts";
import { getCampaignTreeTool, runLaunchChecksTool } from "./pending.ts";
import { morningToplineTool } from "./topline.ts";

export const READ_TOOLS: readonly McpTool[] = [
  morningToplineTool,
  listEventsTool,
  getEventTool,
  getCampaignTreeTool,
  getLearningsTool,
  getDraftsTool,
  getDraftTool,
  runLaunchChecksTool,
];

export const DRAFT_TOOLS: readonly McpTool[] = [
  replicateToEventTool,
  setDraftLinkTool,
  setDraftLocationsTool,
  setDraftBudgetTool,
  applyAudienceTemplateTool,
  listDriveCreativesTool,
  attachDriveCreativesTool,
  archiveDraftTool,
];

export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...DRAFT_TOOLS];
