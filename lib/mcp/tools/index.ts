/**
 * lib/mcp/tools/index.ts — every MCP tool.
 *
 * M1's eight read tools and get_artist (AL5) (scope mcp:read), then the
 * draft tools (scope mcp:draft: app database only, campaign_drafts with
 * status draft): M2's eight and M2b's nine, enough to build a whole
 * campaign as a draft, and M3a's set_draft_name. Then the meta tools
 * (scope mcp:meta, Matas only, each on his chat yes): launch_draft,
 * upload_draft_assets and update_event.
 */
import type { McpTool } from "../tool-types.ts";
import { getArtistTool } from "./artist.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "./draft-drive.ts";
import { applyAudienceTemplateTool, archiveDraftTool, setDraftBudgetTool, setDraftLinkTool, setDraftLocationsTool, setDraftNameTool } from "./draft-edit.ts";
import { launchDraftTool, uploadDraftAssetsTool } from "./meta-launch.ts";
import { updateEventTool } from "./meta-event.ts";
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
  // M3a
  setDraftNameTool,
];

/** Scope mcp:meta (MATAS_USER_IDS only): each takes Matas's chat yes. */
export const META_TOOLS: readonly McpTool[] = [launchDraftTool, uploadDraftAssetsTool, updateEventTool];

export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...DRAFT_TOOLS, ...META_TOOLS];
