/**
 * lib/mcp/tools/index.ts — every MCP tool.
 *
 * M1's eight read tools and get_artist (AL5) (scope mcp:read), then the
 * draft tools (scope mcp:draft: app database only, campaign_drafts with
 * status draft): M2's eight and M2b's nine, enough to build a whole
 * campaign as a draft.
 */
import type { McpTool } from "../tool-types.ts";
import { getArtistTool } from "./artist.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "./draft-drive.ts";
import { applyAudienceTemplateTool, archiveDraftTool, setDraftBudgetTool, setDraftLinkTool, setDraftLocationsTool } from "./draft-edit.ts";
import { replicateToEventTool } from "./draft-replicate.ts";
import { setDraftAudiencesTool } from "./draft-audiences.ts";
import { duplicateDraftTool, removeDraftCreativesTool, setDraftAdNamesTool, setDraftAdSetsTool, setDraftCopyTool, setDraftIdentityTool, setDraftObjectiveTool, setDraftScheduleTool } from "./draft-build.ts";
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
  getArtistTool,
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
  // M2b
  setDraftObjectiveTool,
  setDraftAdSetsTool,
  setDraftAudiencesTool,
  setDraftIdentityTool,
  setDraftCopyTool,
  removeDraftCreativesTool,
  setDraftScheduleTool,
  duplicateDraftTool,
  setDraftAdNamesTool,
];

export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...DRAFT_TOOLS];
