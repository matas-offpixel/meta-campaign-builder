/**
 * lib/mcp/tools/index.ts — every MCP tool.
 *
 * M1's eight read tools, get_artist (AL5) and strict_audit (M3d-d) (scope mcp:read), then the
 * draft tools (scope mcp:draft: app database only, campaign_drafts with
 * status draft): M2's eight and M2b's nine, enough to build a whole
 * campaign as a draft, M3a's set_draft_name, and M3d-c's
 * upload_to_event_folder (one file into a show's own Drive folder). Then the meta tools
 * (scope mcp:meta, Matas only, each on his chat yes): launch_draft,
 * upload_draft_assets and update_event, then M3b's live changes (get_live
 * and list_scheduled read; the rest change live Meta objects). M3d-a adds
 * the shows tools (scope mcp:draft): create_event, create_client,
 * set_lineup, get_releases, set_release. M3d-b adds the Lab tools (scope
 * mcp:draft): list_tracks, set_track_drop, list_clips, set_clip_owner.
 */
import type { McpTool } from "../tool-types.ts";
import { getArtistTool } from "./artist.ts";
import { attachDriveCreativesTool, listDriveCreativesTool } from "./draft-drive.ts";
import { applyAudienceTemplateTool, archiveDraftTool, setDraftBudgetTool, setDraftLinkTool, setDraftLocationsTool, setDraftNameTool } from "./draft-edit.ts";
import { launchDraftTool, uploadDraftAssetsTool } from "./meta-launch.ts";
import { updateEventTool } from "./meta-event.ts";
import { getLiveTool } from "./live-read.ts";
import { pauseTool, resumeTool } from "./live-status.ts";
import { cancelScheduledTool, listScheduledTool, moveBudgetTool, setBudgetTool } from "./live-budget.ts";
import { renameTool } from "./live-rename.ts";
import { addAudienceToStageTool, addCreativesToStageTool } from "./live-stage.ts";
import { createSplitTestTool } from "./live-test.ts";
import { switchedOffUntilShipped } from "../live/shipped.ts";
import { getRenderPackageTool, renderPackageTool } from "./render.ts";
import { listClipsTool, listTracksTool, setClipOwnerTool, setTrackDropTool } from "./lab.ts";
import { uploadToEventFolderTool } from "./folder-in.ts";
import { createClientTool, createEventTool, getReleasesTool, setLineupTool, setReleaseTool } from "./shows.ts";
import { replicateToEventTool } from "./draft-replicate.ts";
import { setDraftAudiencesTool } from "./draft-audiences.ts";
import { duplicateDraftTool, removeDraftCreativesTool, setDraftAdNamesTool, setDraftAdSetsTool, setDraftCopyTool, setDraftIdentityTool, setDraftObjectiveTool, setDraftScheduleTool } from "./draft-build.ts";
import { getDraftTool, getDraftsTool } from "./drafts.ts";
import { getEventTool, listEventsTool } from "./events.ts";
import { getLearningsTool } from "./learnings.ts";
import { getCampaignTreeTool, runLaunchChecksTool } from "./pending.ts";
import { morningToplineTool } from "./topline.ts";
import { strictAuditTool } from "./strict-audit.ts";

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
  // M4a
  getRenderPackageTool,
  // M3d-d
  strictAuditTool,
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
  // M3d-b: the show's Lab material
  listTracksTool,
  setTrackDropTool,
  listClipsTool,
  setClipOwnerTool,
  // M3d-c
  uploadToEventFolderTool,
  // M3d-a: shows and setup
  createClientTool,
  createEventTool,
  setLineupTool,
  getReleasesTool,
  setReleaseTool,
];

/** Scope mcp:meta (MATAS_USER_IDS only): each takes Matas's chat yes. */
export const META_TOOLS: readonly McpTool[] = [
  launchDraftTool,
  uploadDraftAssetsTool,
  updateEventTool,
  // M3b: live changes, on with Today's rows and Undo (lib/mcp/live/shipped.ts, record 2026-11-26-mcp-m3b-today MB4).
  ...[
    getLiveTool,
    pauseTool,
    resumeTool,
    setBudgetTool,
    listScheduledTool,
    cancelScheduledTool,
    moveBudgetTool,
    renameTool,
    addCreativesToStageTool,
    addAudienceToStageTool,
    createSplitTestTool,
  ].map(switchedOffUntilShipped),
];

/** Scope mcp:render (MATAS_USER_IDS only, M4a): each takes Matas's chat yes. */
export const RENDER_TOOLS: readonly McpTool[] = [renderPackageTool];

export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...DRAFT_TOOLS, ...META_TOOLS, ...RENDER_TOOLS];
