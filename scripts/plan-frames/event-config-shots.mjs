/**
 * EC shots: the event page's Dashboard panel (D9, HD2), at 1280 and 393.
 * Ids match scripts/plan-frames/event-config-fixtures.ts. The runner opens
 * /frames/{frame}, so the frame is "event-config/EC1": the nested route
 * app/(dev)/frames/event-config/[id], because app/(dev)/frames/[id]/page.tsx
 * sits in an open Cursor PR.
 * Registered in run.mjs's FRAME_SHOTS. No baselines are committed until
 * design passes.
 */

import { LAUNCH_CHECKS_SHOTS } from "./launch-checks-shots.mjs";
import { LOCATION_PIN_SHOTS } from "./location-pins-shots.mjs";
import { RETARGETING_SHOTS } from "./retargeting-shots.mjs";
import { TEST_PLAN_SHOTS } from "./test-plan-shots.mjs";
import { VARIANT_PAIR_SHOTS } from "./variant-pair-shots.mjs";
import { SNIPPET_PRESS_SHOTS } from "./snippet-press-shots.mjs";

import { MCP_CONSENT_SHOTS } from "./mcp-consent-shots.mjs";
import { CAMPAIGN_TREE_SHOTS } from "./campaign-tree-shots.mjs";
import { RENDER_PACKAGE_SHOTS } from "./render-package-shots.mjs";
import { MCP_TODAY_SHOTS } from "./mcp-today-shots.mjs";

export const EVENT_CONFIG_FRAME_IDS = ["EC1", "EC2", "EC3", "EC4", "EC5", "EC6", "EC7"];
export const EVENT_CONFIG_WIDTHS = [1280, 393];

export const EVENT_CONFIG_SHOTS = [
  // The MCP consent page (#1371): MCP-consent-{claude,loopback} at 1280 and 393, the other states and dark at 393.
  ...MCP_CONSENT_SHOTS,
  // Campaign creator part 4: Replicate to event and the campaign tree (the RC-A … RC-G shots at 1280 and 393).
  ...CAMPAIGN_TREE_SHOTS,
  // M4a: the render-package picker, rows, Today's log and the cost-guard / not-in-Drive frames (M4-*, 1280 and 393).
  ...RENDER_PACKAGE_SHOTS,
  // M3b on Today: Claude's Meta changes, MB-A and MB-B, with FC-A and FC-B (M3B-*, 1280 and 393).
  ...MCP_TODAY_SHOTS,
  ...EVENT_CONFIG_FRAME_IDS.flatMap((frame) =>
    EVENT_CONFIG_WIDTHS.map((width) => ({
      id: `${frame}-${width}`,
      frame: `event-config/${frame}`,
      width,
      lab: false,
      before: null,
    })),
  ),
  // Creative testing's Test plan shots (TF-A, TF-B, TT-D, TF-C), listed here while run.mjs sits in open PRs.
  ...TEST_PLAN_SHOTS,
  // The Retargeting campaign's PR A shots (RB, RD at 1280 and 393).
  ...RETARGETING_SHOTS,
  // Creative test variant pairs (VP-A, VP-B, VP-C at 1280 and 393).
  ...VARIANT_PAIR_SHOTS,
  // M3d-b: the Snippet tab's one window, a press on a no-drop file (SNP-A before, SNP-B after, at 1280 and 393).
  ...SNIPPET_PRESS_SHOTS,
  // Launch checks on Review & launch (RC-C, RC-C-clean, RC-C-venue at 1280 and 393).
  ...LAUNCH_CHECKS_SHOTS,
  // The location pin (LP-A, LP-B, LP-C and their states, at 1280 and 393).
  ...LOCATION_PIN_SHOTS,
];
